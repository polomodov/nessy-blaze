import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewIframeRefAtom,
  selectedComponentsPreviewAtom,
} from "@/atoms/previewAtoms";
import type { ComponentSelection } from "@/ipc/ipc_types";
import { BlazeChatArea } from "./BlazeChatArea";
import {
  WORKSPACE_AUTOFIX_COMPLETED_EVENT,
  WORKSPACE_AUTOFIX_STARTED_EVENT,
  WORKSPACE_PREVIEW_REFRESH_EVENT,
  type WorkspacePreviewRefreshDetail,
} from "./autofix_events";

const {
  createAppMock,
  streamMessageMock,
  cancelChatStreamMock,
  getChatsMock,
  getChatMock,
  createChatMock,
  listVersionsMock,
  getProposalMock,
  approveProposalMock,
  revertVersionMock,
} = vi.hoisted(() => ({
  createAppMock: vi.fn(),
  streamMessageMock: vi.fn(),
  cancelChatStreamMock: vi.fn(),
  getChatsMock: vi.fn(),
  getChatMock: vi.fn(),
  createChatMock: vi.fn(),
  listVersionsMock: vi.fn(),
  getProposalMock: vi.fn(),
  approveProposalMock: vi.fn(),
  revertVersionMock: vi.fn(),
}));

const { settingsRef } = vi.hoisted(() => ({
  settingsRef: {
    current: { autoApproveChanges: false } as {
      autoApproveChanges?: boolean;
    } | null,
  },
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      createApp: createAppMock,
      streamMessage: streamMessageMock,
      cancelChatStream: cancelChatStreamMock,
      getChats: getChatsMock,
      getChat: getChatMock,
      createChat: createChatMock,
      listVersions: listVersionsMock,
      getProposal: getProposalMock,
      approveProposal: approveProposalMock,
      revertVersion: revertVersionMock,
    })),
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settingsRef.current,
  }),
}));

function buildPendingProposal(chatId = 77, messageId = 2) {
  return {
    chatId,
    messageId,
    proposal: {
      type: "code-proposal" as const,
      title: "Apply landing updates",
      securityRisks: [],
      filesChanged: [
        {
          name: "App.tsx",
          path: "src/App.tsx",
          summary: "Update hero",
          type: "write" as const,
        },
      ],
      packagesAdded: ["zod"],
    },
  };
}

describe("BlazeChatArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = { autoApproveChanges: false };
    streamMessageMock.mockImplementation(() => {});
    getChatsMock.mockResolvedValue([]);
    getProposalMock.mockResolvedValue(null);
    listVersionsMock.mockResolvedValue([]);
    approveProposalMock.mockResolvedValue({
      updatedFiles: false,
      extraFiles: undefined,
      extraFilesError: undefined,
    });
    revertVersionMock.mockResolvedValue({
      successMessage: "Restored version",
    });
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

  it("shows action-only marker for assistant messages in loaded history", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 31,
        appId: 10,
        title: "Chat with actions",
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 31,
      appId: 10,
      title: "Chat with actions",
      messages: [
        { id: 1, role: "user", content: "Run update" },
        {
          id: 2,
          role: "assistant",
          content:
            '<blaze-write path="src/App.tsx">export default function App(){return null;}</blaze-write>',
        },
      ],
    });

    render(<BlazeChatArea activeAppId={10} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(10);
      expect(getChatMock).toHaveBeenCalledWith(31);
    });

    expect(screen.getByText("Run update")).toBeTruthy();
    expect(
      screen.getByText("Ассистент ответил внутренними действиями."),
    ).toBeTruthy();
  });

  it("renders assistant markdown with rich formatting", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 41,
        appId: 11,
        title: "Markdown chat",
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 41,
      appId: 11,
      title: "Markdown chat",
      messages: [
        { id: 1, role: "user", content: "Что сделали?" },
        {
          id: 2,
          role: "assistant",
          content:
            "### Что изменилось\n- Добавлен новый блок\n- Обновлена кнопка",
        },
      ],
    });

    render(<BlazeChatArea activeAppId={11} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(11);
      expect(getChatMock).toHaveBeenCalledWith(41);
    });

    expect(
      screen.getByRole("heading", { name: "Что изменилось" }),
    ).toBeTruthy();
    expect(screen.getByText("Добавлен новый блок")).toBeTruthy();
    expect(screen.getByText("Обновлена кнопка")).toBeTruthy();
  });

  it("shows last 4 messages initially and loads older history on upward scroll", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 61,
        appId: 12,
        title: "Long chat",
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 61,
      appId: 12,
      title: "Long chat",
      messages: [
        { id: 1, role: "user", content: "Message 1" },
        { id: 2, role: "assistant", content: "Message 2" },
        { id: 3, role: "user", content: "Message 3" },
        { id: 4, role: "assistant", content: "Message 4" },
        { id: 5, role: "user", content: "Message 5" },
        { id: 6, role: "assistant", content: "Message 6" },
      ],
    });

    render(<BlazeChatArea activeAppId={12} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(12);
      expect(getChatMock).toHaveBeenCalledWith(61);
    });

    expect(screen.queryByText("Message 1")).toBeNull();
    expect(screen.queryByText("Message 2")).toBeNull();
    expect(screen.getByText("Message 3")).toBeTruthy();
    expect(screen.getByText("Message 6")).toBeTruthy();

    const scrollContainer = screen.getByTestId("workspace-chat-scroll");
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1200,
      writable: true,
    });
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeTruthy();
      expect(screen.getByText("Message 2")).toBeTruthy();
    });
  });

  it("auto-loads older messages when initial history slice has no overflow", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 62,
        appId: 14,
        title: "No overflow chat",
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 62,
      appId: 14,
      title: "No overflow chat",
      messages: [
        { id: 1, role: "user", content: "Message 1" },
        { id: 2, role: "assistant", content: "Message 2" },
        { id: 3, role: "user", content: "Message 3" },
        { id: 4, role: "assistant", content: "Message 4" },
        { id: 5, role: "user", content: "Message 5" },
        { id: 6, role: "assistant", content: "Message 6" },
      ],
    });

    render(<BlazeChatArea activeAppId={14} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(14);
      expect(getChatMock).toHaveBeenCalledWith(62);
    });

    const scrollContainer = screen.getByTestId("workspace-chat-scroll");
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 300,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeTruthy();
      expect(screen.getByText("Message 2")).toBeTruthy();
      expect(screen.getByText("Message 6")).toBeTruthy();
    });
  });

  it("shows sent and received timestamps for messages", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 71,
        appId: 13,
        title: "Timestamps chat",
        createdAt: new Date("2026-02-19T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValue({
      id: 71,
      appId: 13,
      title: "Timestamps chat",
      messages: [
        {
          id: 1,
          role: "user",
          content: "First message",
          createdAt: "2026-02-19T10:00:00.000Z",
        },
        {
          id: 2,
          role: "assistant",
          content: "Assistant response",
          createdAt: "2026-02-19T10:01:00.000Z",
        },
      ],
    });

    render(<BlazeChatArea activeAppId={13} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(13);
      expect(getChatMock).toHaveBeenCalledWith(71);
    });

    expect(screen.getByText(/^Отправлено:/)).toBeTruthy();
    expect(screen.getByText(/^Получено:/)).toBeTruthy();
  });

  it("loads version history when history tab is opened", async () => {
    listVersionsMock.mockResolvedValue([
      {
        oid: "abc123def456",
        message: "Updated landing hero",
        timestamp: 1760000000,
      },
    ]);

    render(<BlazeChatArea activeAppId={13} />);

    fireEvent.click(screen.getByTestId("workspace-chat-tab-history"));

    await waitFor(() => {
      expect(listVersionsMock).toHaveBeenCalledWith({ appId: 13 });
      expect(screen.getByText("Updated landing hero")).toBeTruthy();
    });
  });

  it("restores version from history tab", async () => {
    listVersionsMock.mockResolvedValue([
      {
        oid: "deadbeef1234567",
        message: "Before CTA redesign",
        timestamp: 1761000000,
      },
    ]);

    render(<BlazeChatArea activeAppId={88} />);

    fireEvent.click(screen.getByTestId("workspace-chat-tab-history"));

    await waitFor(() => {
      expect(
        screen.getByTestId("history-restore-deadbeef1234567"),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("history-restore-deadbeef1234567"));

    await waitFor(() => {
      expect(revertVersionMock).toHaveBeenCalledWith({
        appId: 88,
        previousVersionId: "deadbeef1234567",
      });
    });
  });

  it("shows optimistic auto-fix start message in chat", async () => {
    render(<BlazeChatArea />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_AUTOFIX_STARTED_EVENT, {
          detail: {
            chatId: 77,
            message:
              "Автофикс запущен. Собираем диагностику и готовим изменения.",
          },
        }),
      );
    });

    expect(
      screen.getByText(
        "Автофикс запущен. Собираем диагностику и готовим изменения.",
      ),
    ).toBeTruthy();
  });

  it("refreshes chat and pending manual approval when auto-fix completes", async () => {
    getChatMock.mockResolvedValueOnce({
      id: 77,
      appId: 42,
      title: "Chat",
      messages: [
        { id: 1, role: "user", content: "Автофикс запущен" },
        { id: 2, role: "assistant", content: "### Что изменилось" },
      ],
    });
    getProposalMock.mockResolvedValueOnce(buildPendingProposal(77, 22));

    render(<BlazeChatArea activeAppId={42} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_AUTOFIX_COMPLETED_EVENT, {
          detail: { chatId: 77 },
        }),
      );
    });

    await waitFor(() => {
      expect(getChatMock).toHaveBeenCalledWith(77);
      expect(getProposalMock).toHaveBeenCalledWith(77);
      expect(
        screen.getByRole("heading", { name: "Что изменилось" }),
      ).toBeTruthy();
      expect(screen.getByTestId("manual-approve-button")).toBeTruthy();
    });
  });

  it("creates chat in selected app without creating new app", async () => {
    render(<BlazeChatArea activeAppId={88} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(88);
    });

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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

  it("cancels the active stream from chat input", async () => {
    render(<BlazeChatArea activeAppId={88} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(88);
    });

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Add account settings page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("chat-cancel-button")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("chat-cancel-button"));

    expect(cancelChatStreamMock).toHaveBeenCalledTimes(1);
    expect(cancelChatStreamMock).toHaveBeenCalledWith(300);
    expect(screen.queryByText("Агент формирует ответ...")).toBeNull();
  });

  it("keeps waiting indicator for a pending stream after switching projects away and back", async () => {
    getChatsMock.mockImplementation(async (appId?: number) => {
      if (appId === 1) {
        return [
          {
            id: 300,
            appId: 1,
            title: "Project one chat",
            createdAt: new Date("2026-02-19T00:00:00.000Z"),
          },
        ];
      }

      if (appId === 2) {
        return [
          {
            id: 400,
            appId: 2,
            title: "Project two chat",
            createdAt: new Date("2026-02-19T00:10:00.000Z"),
          },
        ];
      }

      return [];
    });

    getChatMock.mockImplementation(async (chatId: number) => {
      if (chatId === 300) {
        return {
          id: 300,
          appId: 1,
          title: "Project one chat",
          messages: [{ id: 1, role: "user", content: "First project context" }],
        };
      }

      return {
        id: 400,
        appId: 2,
        title: "Project two chat",
        messages: [{ id: 2, role: "user", content: "Second project context" }],
      };
    });

    const view = render(<BlazeChatArea activeAppId={1} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(1);
      expect(getChatMock).toHaveBeenCalledWith(300);
    });

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Continue first project" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Агент формирует ответ...")).toBeTruthy();
    });

    view.rerender(<BlazeChatArea activeAppId={2} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(2);
      expect(getChatMock).toHaveBeenCalledWith(400);
      expect(screen.getByText("Second project context")).toBeTruthy();
    });
    expect(screen.queryByText("Агент формирует ответ...")).toBeNull();

    view.rerender(<BlazeChatArea activeAppId={1} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(1);
      expect(screen.getByText("First project context")).toBeTruthy();
      expect(screen.getByText("Агент формирует ответ...")).toBeTruthy();
    });
  });

  it("creates app on first message and reuses chat on next messages", async () => {
    const onAppCreated = vi.fn();
    render(<BlazeChatArea onAppCreated={onAppCreated} />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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

  it("sends selected preview components with prompt context", async () => {
    const store = createStore();
    const selectedComponent: ComponentSelection = {
      id: "src/App.tsx:12:5",
      name: "HeroSection",
      runtimeId: "runtime-1",
      relativePath: "src/App.tsx",
      lineNumber: 12,
      columnNumber: 5,
    };
    const postMessageMock = vi.fn();

    store.set(selectedComponentsPreviewAtom, [selectedComponent]);
    store.set(previewIframeRefAtom, {
      contentWindow: {
        postMessage: postMessageMock,
      },
    } as unknown as HTMLIFrameElement);

    render(
      <Provider store={store}>
        <BlazeChatArea />
      </Provider>,
    );

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, {
      target: { value: "Сделай этот блок компактнее и смени отступы" },
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    expect(streamMessageMock).toHaveBeenCalledWith(
      "Сделай этот блок компактнее и смени отступы",
      expect.objectContaining({
        chatId: 77,
        selectedComponents: [selectedComponent],
      }),
    );

    expect(postMessageMock).toHaveBeenCalledWith(
      { type: "clear-blaze-component-overlays" },
      "*",
    );
    expect(postMessageMock).toHaveBeenCalledWith(
      { type: "deactivate-blaze-component-selector" },
      "*",
    );
    expect(store.get(selectedComponentsPreviewAtom)).toEqual([]);
  });

  it("shows backend error from stream callback", async () => {
    streamMessageMock.mockImplementation(
      (_prompt: string, options: { onError: (error: string) => void }) => {
        options.onError("Backend unavailable");
      },
    );

    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Build page" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Backend unavailable")).toBeTruthy();
    });
  });

  it("strips blaze control markup from assistant output", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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

  it("shows blaze-status content behind an expandable diagnostic block", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Update section anchor" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    const streamOptions = streamMessageMock.mock.calls[0][1];
    act(() => {
      streamOptions.onUpdate([
        { id: 1, role: "user", content: "Update section anchor" },
        {
          id: 2,
          role: "assistant",
          content: `<blaze-chat-summary>Anchor updated</blaze-chat-summary>
<blaze-status title="Change ready">Status: Change ready for approval.
Files to write: 1</blaze-status>`,
        },
      ]);
      streamOptions.onEnd({ chatId: 77, updatedFiles: false });
    });

    expect(screen.getByRole("button", { name: /Change ready/i })).toBeTruthy();
    expect(
      screen.queryByText(/Status: Change ready for approval\./),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Change ready/i }));
    expect(
      screen.getByText(/Status: Change ready for approval\./),
    ).toBeTruthy();
    expect(
      screen.queryByText("Ассистент ответил внутренними действиями."),
    ).toBeNull();
  });

  it("shows marker when assistant message contains only control markup", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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
    expect(
      screen.getByText("Ассистент ответил внутренними действиями."),
    ).toBeTruthy();
    expect(screen.queryByText(/const x = 1/)).toBeNull();
    expect(screen.queryByText(/blaze-write/i)).toBeNull();
  });

  it("shows manual approve button when a code proposal is pending", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Update landing page hero" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    getProposalMock.mockResolvedValue(buildPendingProposal());
    const streamOptions = streamMessageMock.mock.calls[0][1];

    act(() => {
      streamOptions.onEnd({ chatId: 77, updatedFiles: false });
    });

    await waitFor(() => {
      expect(getProposalMock).toHaveBeenCalledWith(77);
      expect(screen.getByTestId("manual-approve-button")).toBeTruthy();
    });

    expect(screen.getByText("Изменения ждут ручного аппрува")).toBeTruthy();
  });

  it("approves pending proposal from manual approve button", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Apply CTA updates" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    getProposalMock.mockResolvedValue(buildPendingProposal(77, 21));
    const streamOptions = streamMessageMock.mock.calls[0][1];

    act(() => {
      streamOptions.onEnd({ chatId: 77, updatedFiles: false });
    });

    await waitFor(() => {
      expect(screen.getByTestId("manual-approve-button")).toBeTruthy();
    });

    getChatMock.mockResolvedValueOnce({
      id: 77,
      appId: 42,
      title: "Chat",
      messages: [
        { id: 1, role: "user", content: "Apply CTA updates" },
        { id: 2, role: "assistant", content: "Готово, изменения применены." },
      ],
    });
    getProposalMock.mockResolvedValueOnce(null);

    const previewRefreshListener = vi.fn();
    window.addEventListener(
      WORKSPACE_PREVIEW_REFRESH_EVENT,
      previewRefreshListener as EventListener,
    );
    approveProposalMock.mockResolvedValueOnce({
      updatedFiles: true,
      extraFiles: undefined,
      extraFilesError: undefined,
    });

    fireEvent.click(screen.getByTestId("manual-approve-button"));

    await waitFor(() => {
      expect(approveProposalMock).toHaveBeenCalledWith({
        chatId: 77,
        messageId: 21,
      });
      expect(screen.queryByTestId("manual-approve-button")).toBeNull();
    });

    await waitFor(() => {
      expect(previewRefreshListener).toHaveBeenCalledTimes(1);
    });
    const refreshEvent = previewRefreshListener.mock
      .calls[0][0] as CustomEvent<WorkspacePreviewRefreshDetail>;
    expect(refreshEvent.detail).toEqual({
      appId: 42,
      reason: "manual-approve",
    });
    window.removeEventListener(
      WORKSPACE_PREVIEW_REFRESH_EVENT,
      previewRefreshListener as EventListener,
    );
  });

  it("does not show manual approve button in auto-apply mode", async () => {
    settingsRef.current = { autoApproveChanges: true };
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
    fireEvent.change(input, { target: { value: "Update landing page hero" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(streamMessageMock).toHaveBeenCalledTimes(1);
    });

    getProposalMock.mockResolvedValue(buildPendingProposal());
    const streamOptions = streamMessageMock.mock.calls[0][1];

    act(() => {
      streamOptions.onEnd({ chatId: 77, updatedFiles: true });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("manual-approve-button")).toBeNull();
    });
    expect(getProposalMock).not.toHaveBeenCalled();
  });

  it("rolls back changes from assistant message with source commit hash", async () => {
    getChatsMock.mockResolvedValue([
      {
        id: 51,
        appId: 88,
        title: "Rollback chat",
        createdAt: new Date("2026-02-20T00:00:00.000Z"),
      },
    ]);
    getChatMock.mockResolvedValueOnce({
      id: 51,
      appId: 88,
      title: "Rollback chat",
      messages: [
        { id: 100, role: "user", content: "Update hero block" },
        {
          id: 101,
          role: "assistant",
          content: "Выполнил изменения.",
          sourceCommitHash: "abc123def",
        },
      ],
    });

    render(<BlazeChatArea activeAppId={88} />);

    await waitFor(() => {
      expect(getChatsMock).toHaveBeenCalledWith(88);
      expect(screen.getByTestId("rollback-button-101")).toBeTruthy();
    });

    getChatMock.mockResolvedValueOnce({
      id: 51,
      appId: 88,
      title: "Rollback chat",
      messages: [{ id: 100, role: "user", content: "Update hero block" }],
    });

    fireEvent.click(screen.getByTestId("rollback-button-101"));

    await waitFor(() => {
      expect(revertVersionMock).toHaveBeenCalledWith({
        appId: 88,
        previousVersionId: "abc123def",
        currentChatMessageId: {
          chatId: 51,
          messageId: 100,
        },
      });
      expect(getChatMock).toHaveBeenCalledWith(51);
    });
  });

  it("does not show code from an unclosed blaze block during streaming", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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

    const input = screen.getByPlaceholderText("Опишите, что нужно собрать...");
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
      screen.getByText("Агент думает и применяет изменения..."),
    ).toBeTruthy();
  });

  it("auto-resizes the main chat textarea while typing", async () => {
    render(<BlazeChatArea />);

    const input = screen.getByPlaceholderText(
      "Опишите, что нужно собрать...",
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
