import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlazePreviewPanel } from "./BlazePreviewPanel";

const { runAppMock, stopAppMock } = vi.hoisted(() => ({
  runAppMock: vi.fn(),
  stopAppMock: vi.fn(),
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      runApp: runAppMock,
      stopApp: stopAppMock,
    })),
  },
}));

describe("BlazePreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopAppMock.mockResolvedValue(undefined);
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

  it("shows error state when app run fails", async () => {
    runAppMock.mockRejectedValue(new Error("Port is busy"));

    render(<BlazePreviewPanel activeAppId={55} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to start preview")).toBeTruthy();
      expect(screen.getByText("Port is busy")).toBeTruthy();
    });
  });
});
