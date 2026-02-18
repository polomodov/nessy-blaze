import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlazeChatArea } from "./BlazeChatArea";

const { createAppMock, streamMessageMock } = vi.hoisted(() => ({
  createAppMock: vi.fn(),
  streamMessageMock: vi.fn(),
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      createApp: createAppMock,
      streamMessage: streamMessageMock,
    })),
  },
}));

describe("BlazeChatArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAppMock.mockResolvedValue({
      app: {
        id: 42,
        name: "Test app",
        path: "/tmp/test-app",
        createdAt: "2026-02-16T00:00:00.000Z",
        updatedAt: "2026-02-16T00:00:00.000Z",
      },
      chatId: 77,
    });
  });

  it("creates app on first message and reuses chat on next messages", async () => {
    const onAppCreated = vi.fn();
    render(<BlazeChatArea onAppCreated={onAppCreated} />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Build a landing page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(createAppMock).toHaveBeenCalledTimes(1);
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(streamMessageMock).toHaveBeenNthCalledWith(
      1,
      "Build a landing page",
      expect.objectContaining({
        chatId: 77,
        onUpdate: expect.any(Function),
        onEnd: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(onAppCreated).toHaveBeenCalledWith(42);

    const firstStreamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      firstStreamOptions.onUpdate([
        { id: 1, role: "user", content: "Build a landing page" },
        { id: 2, role: "assistant", content: "Sure, drafting now." },
      ]);
      firstStreamOptions.onEnd({ chatId: 77, updatedFiles: false });
    });

    expect(screen.getByText("Sure, drafting now.")).toBeTruthy();

    fireEvent.change(input, { target: { value: "Add FAQ section" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(2);
    });

    expect(createAppMock).toHaveBeenCalledTimes(1);
    expect(streamMessageMock).toHaveBeenNthCalledWith(
      2,
      "Add FAQ section",
      expect.objectContaining({
        chatId: 77,
      }),
    );
  });

  it("shows backend error from stream callback", async () => {
    streamMessageMock.mockImplementation(
      (_prompt: string, options: { onError: (error: string) => void }) => {
        options.onError("Backend unavailable");
      },
    );

    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Build page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Backend unavailable")).toBeTruthy();
    });
  });
});
