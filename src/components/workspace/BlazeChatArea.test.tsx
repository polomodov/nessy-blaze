import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlazeChatArea } from "./BlazeChatArea";

const {
  createAppMock,
  streamMessageMock,
  getChatsMock,
  getChatMock,
  createChatMock,
} = vi.hoisted(() => ({
  createAppMock: vi.fn(),
  streamMessageMock: vi.fn(),
  getChatsMock: vi.fn(),
  getChatMock: vi.fn(),
  createChatMock: vi.fn(),
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      createApp: createAppMock,
      streamMessage: streamMessageMock,
      getChats: getChatsMock,
      getChat: getChatMock,
      createChat: createChatMock,
    })),
  },
}));

describe("BlazeChatArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamMessageMock.mockImplementation(() => {});
    getChatsMock.mockResolvedValue([]);
    getChatMock.mockResolvedValue({
      id: 0,
      appId: 0,
      title: null,
      messages: [],
    });
    createChatMock.mockResolvedValue(300);
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

  it("loads latest interaction history for selected app", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 11,
        appId: 7,
        title: "Older chat",
        createdAt: new Date("2026-02-16T00:00:00.000Z"),
      },
      {
        id: 12,
        appId: 7,
        title: "Latest chat",
        createdAt: new Date("2026-02-17T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 12,
      appId: 7,
      title: "Latest chat",
      messages: [
        { id: 1, role: "user", content: "Previous user request" },
        { id: 2, role: "assistant", content: "Previous assistant response" },
      ],
    });

    render(<BlazeChatArea activeAppId={7} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(7);
      expect(getChatMock).toHaveBeenCalledWith(12);
    });

    expect(screen.getByText("Previous user request")).toBeTruthy();
    expect(screen.getByText("Previous assistant response")).toBeTruthy();
  });

  it("falls back to latest non-empty chat when newest chat is empty", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 21,
        appId: 9,
        title: "Newest but empty",
        createdAt: new Date("2026-02-18T00:00:00.000Z"),
      },
      {
        id: 20,
        appId: 9,
        title: "Older with content",
        createdAt: new Date("2026-02-17T00:00:00.000Z"),
      },
    ]);

    getChatMock.mockImplementation(async (chatId: number) => {
      if (chatId === 21) {
        return {
          id: 21,
          appId: 9,
          title: "Newest but empty",
          messages: [],
        };
      }

      return {
        id: 20,
        appId: 9,
        title: "Older with content",
        messages: [{ id: 1, role: "user", content: "Recovered history" }],
      };
    });

    render(<BlazeChatArea activeAppId={9} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(9);
      expect(getChatMock).toHaveBeenCalledWith(21);
      expect(getChatMock).toHaveBeenCalledWith(20);
    });

    expect(screen.getByText("Recovered history")).toBeTruthy();
  });

  it("creates chat in selected app without creating new app", async () => {
    render(<BlazeChatArea activeAppId={88} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(88);
    });

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Add account settings page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(createChatMock).toHaveBeenCalledWith(88);
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(createAppMock).not.toHaveBeenCalled();
    expect(streamMessageMock).toHaveBeenCalledWith(
      "Add account settings page",
      expect.objectContaining({
        chatId: 300,
      }),
    );
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

  it("strips blaze control markup from assistant output", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Create About page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    const streamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Create About page" },
        {
          id: 2,
          role: "assistant",
          content: `I'll create a modern page.\n<blaze-write path="src/pages/About.tsx">const x = 1;</blaze-write>\nNow adding route.\n<blaze-chat-summary>About page</blaze-chat-summary>`,
        },
      ]);
      streamOptions.onEnd({ chatId: 77, updatedFiles: true });
    });

    expect(screen.getByText(/I'll create a modern page\./)).toBeTruthy();
    expect(screen.getByText(/Now adding route\./)).toBeTruthy();
    expect(screen.queryByText(/blaze-write/i)).toBeNull();
    expect(screen.queryByText(/blaze-chat-summary/i)).toBeNull();
  });

  it("hides assistant messages that only contain control markup", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Create About page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    const streamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Create About page" },
        {
          id: 2,
          role: "assistant",
          content:
            '<blaze-write path="src/pages/About.tsx">const x = 1;</blaze-write><blaze-chat-summary>About page</blaze-chat-summary>',
        },
      ]);
      streamOptions.onEnd({ chatId: 77, updatedFiles: true });
    });

    expect(screen.getByText("Create About page")).toBeTruthy();
    expect(screen.queryByText(/const x = 1/)).toBeNull();
    expect(screen.queryByText(/blaze-write/i)).toBeNull();
  });

  it("does not show code from an unclosed blaze block during streaming", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Create About page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    const streamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Create About page" },
        {
          id: 2,
          role: "assistant",
          content:
            'Starting update...\n<blaze-write path="src/pages/About.tsx">const hidden = "code";',
        },
      ]);
    });

    expect(screen.getByText(/Starting update/)).toBeTruthy();
    expect(screen.queryByText(/const hidden = "code"/)).toBeNull();
    expect(screen.queryByText(/blaze-write/i)).toBeNull();

    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Create About page" },
        {
          id: 2,
          role: "assistant",
          content:
            'Starting update...\n<blaze-write path="src/pages/About.tsx">const hidden = "code";</blaze-write>\nDone.',
        },
      ]);
      streamOptions.onEnd({ chatId: 77, updatedFiles: true });
    });

    expect(screen.getByText(/Done\./)).toBeTruthy();
    expect(screen.queryByText(/const hidden = "code"/)).toBeNull();
    expect(screen.queryByText(/blaze-write/i)).toBeNull();
  });

  it("shows progress text when assistant emits only internal markup", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    );
    fireEvent.change(input, { target: { value: "Create settings page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    const streamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Create settings page" },
        {
          id: 2,
          role: "assistant",
          content:
            '<think>Planning updates...</think><blaze-write path="src/pages/Settings.tsx">export default function Settings(){return null;}</blaze-write>',
        },
      ]);
    });

    expect(
      screen.getByText("Agent is thinking and applying changes..."),
    ).toBeTruthy();
  });

  it("auto-resizes the main chat textarea while typing", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Describe what should be built...",
    ) as HTMLTextAreaElement;

    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => {
        const lineCount = Math.max(1, input.value.split("\n").length);
        return lineCount * 24;
      },
    });

    await waitFor(() => {
      expect(input.style.height).toBe("40px");
    });

    fireEvent.change(input, {
      target: { value: "line1\nline2\nline3\nline4" },
    });

    await waitFor(() => {
      expect(input.style.height).toBe("96px");
      expect(input.style.overflowY).toBe("hidden");
    });

    fireEvent.change(input, {
      target: { value: Array.from({ length: 10 }, () => "line").join("\n") },
    });

    await waitFor(() => {
      expect(input.style.height).toBe("120px");
      expect(input.style.overflowY).toBe("auto");
    });
  });
});
