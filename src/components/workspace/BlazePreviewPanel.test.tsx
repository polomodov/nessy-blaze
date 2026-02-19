import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlazePreviewPanel } from "./BlazePreviewPanel";

const { runAppMock, stopAppMock, readAppFileMock } = vi.hoisted(() => ({
  runAppMock: vi.fn(),
  stopAppMock: vi.fn(),
  readAppFileMock: vi.fn(),
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      runApp: runAppMock,
      stopApp: stopAppMock,
      readAppFile: readAppFileMock,
    })),
  },
}));

describe("BlazePreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopAppMock.mockResolvedValue(undefined);
    readAppFileMock.mockResolvedValue(`
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    `);
  });

  it("shows empty state when no app is selected", () => {
    render(<BlazePreviewPanel activeAppId={null} />);

    expect(screen.getByText("App preview")).toBeTruthy();
    expect(
      screen.getByText(
        "Send a message in chat to create an app and run live preview.",
      ),
    ).toBeTruthy();
    expect(runAppMock).not.toHaveBeenCalled();
  });

  it("starts app and renders iframe when proxy url is available", async () => {
    runAppMock.mockImplementation(
      async (
        appId: number,
        onOutput: (payload: {
          type: "info";
          message: string;
          appId: number;
          timestamp: number;
        }) => void,
      ) => {
        onOutput({
          type: "info",
          message:
            "[blaze-proxy-server]started=[about:blank] original=[http://127.0.0.1:5173]",
          appId,
          timestamp: Date.now(),
        });
      },
    );

    render(<BlazePreviewPanel activeAppId={42} />);

    await waitFor(() => {
      expect(runAppMock).toHaveBeenCalledTimes(1);
      expect(runAppMock).toHaveBeenCalledWith(42, expect.any(Function));
    });

    const iframe = await screen.findByTitle("Generated app preview");
    expect(iframe.getAttribute("src")).toBe("about:blank");
  });

  it("renders page dropdown and switches preview path", async () => {
    runAppMock.mockImplementation(
      async (
        appId: number,
        onOutput: (payload: {
          type: "info";
          message: string;
          appId: number;
          timestamp: number;
        }) => void,
      ) => {
        onOutput({
          type: "info",
          message:
            "[blaze-proxy-server]started=[about:blank] original=[http://127.0.0.1:5173]",
          appId,
          timestamp: Date.now(),
        });
      },
    );
    readAppFileMock.mockResolvedValue(`
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/services" element={<Services />} />
      </Routes>
    `);

    render(<BlazePreviewPanel activeAppId={9} />);

    await screen.findByLabelText("Preview page");
    await screen.findByRole("option", { name: "Home (/)" });
    await screen.findByRole("option", { name: "/about" });
    await screen.findByRole("option", { name: "/services" });

    const pageSelect = screen.getByLabelText("Preview page");
    fireEvent.change(pageSelect, { target: { value: "/about" } });

    await waitFor(() => {
      expect((pageSelect as HTMLSelectElement).value).toBe("/about");
      const iframe = screen.getByTitle("Generated app preview");
      expect(iframe.getAttribute("src")).toContain("about:");
    });
  });

  it("shows error state when app run fails", async () => {
    runAppMock.mockRejectedValue(new Error("Port is busy"));

    render(<BlazePreviewPanel activeAppId={55} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to start preview")).toBeTruthy();
      expect(screen.getByText("Port is busy")).toBeTruthy();
    });
  });
});
