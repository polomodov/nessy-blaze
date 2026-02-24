import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { BlazePreviewPanel } from "./BlazePreviewPanel";
import {
  WORKSPACE_PREVIEW_REFRESH_EVENT,
  type WorkspacePreviewRefreshDetail,
} from "./autofix_events";

const {
  runAppMock,
  restartAppMock,
  stopAppMock,
  readAppFileMock,
  getChatsMock,
  createChatMock,
  addLogMock,
  onChatStreamEndMock,
  streamEndHandlerRef,
  streamMessageMock,
  triggerAIFixMock,
} = vi.hoisted(() => ({
  runAppMock: vi.fn(),
  restartAppMock: vi.fn(),
  stopAppMock: vi.fn(),
  readAppFileMock: vi.fn(),
  getChatsMock: vi.fn(),
  createChatMock: vi.fn(),
  addLogMock: vi.fn(),
  onChatStreamEndMock: vi.fn(),
  streamEndHandlerRef: {
    current: null as ((chatId: number) => void) | null,
  },
  streamMessageMock: vi.fn(),
  triggerAIFixMock: vi.fn(),
}));

onChatStreamEndMock.mockImplementation((handler: (chatId: number) => void) => {
  streamEndHandlerRef.current = handler;
  return () => {
    if (streamEndHandlerRef.current === handler) {
      streamEndHandlerRef.current = null;
    }
  };
});

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      runApp: runAppMock,
      restartApp: restartAppMock,
      stopApp: stopAppMock,
      readAppFile: readAppFileMock,
      getChats: getChatsMock,
      createChat: createChatMock,
      addLog: addLogMock,
      onChatStreamEnd: onChatStreamEndMock,
    })),
  },
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: streamMessageMock,
    isStreaming: false,
  }),
}));

vi.mock("@/components/preview_panel/use_error_autofix", () => ({
  useErrorAutofix: () => ({
    triggerAIFix: triggerAIFixMock,
  }),
}));

describe("BlazePreviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamEndHandlerRef.current = null;
    restartAppMock.mockResolvedValue({ success: true });
    stopAppMock.mockResolvedValue(undefined);
    getChatsMock.mockResolvedValue([]);
    createChatMock.mockResolvedValue(999);
    readAppFileMock.mockResolvedValue(`
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    `);
  });

  it("shows empty state when no app is selected", () => {
    render(<BlazePreviewPanel activeAppId={null} />);

    expect(screen.getByText("Предпросмотр приложения")).toBeTruthy();
    expect(
      screen.getByText(
        "Отправьте сообщение в чат, чтобы создать приложение и запустить live preview.",
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

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );
    expect(iframe.getAttribute("src")).toBe("about:blank");
  });

  it("refreshes iframe source when refresh button is clicked", async () => {
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

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );
    expect(iframe.getAttribute("src")).toBe("about:blank");

    fireEvent.click(screen.getByTestId("preview-refresh-iframe-button"));

    await waitFor(() => {
      expect(iframe.getAttribute("src")).toContain("__blaze_iframe_refresh=1");
    });
  });

  it("restarts preview when manual apply requests refresh", async () => {
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
    restartAppMock.mockImplementation(
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
        return { success: true };
      },
    );

    render(<BlazePreviewPanel activeAppId={42} />);

    await waitFor(() => {
      expect(runAppMock).toHaveBeenCalledWith(42, expect.any(Function));
    });

    act(() => {
      const detail: WorkspacePreviewRefreshDetail = {
        appId: 42,
        reason: "manual-approve",
      };
      window.dispatchEvent(
        new CustomEvent<WorkspacePreviewRefreshDetail>(
          WORKSPACE_PREVIEW_REFRESH_EVENT,
          { detail },
        ),
      );
    });

    await waitFor(() => {
      expect(restartAppMock).toHaveBeenCalledWith(42, expect.any(Function));
    });
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

    await screen.findByLabelText("Страница предпросмотра");
    await screen.findByRole("option", { name: "Главная (/)" });
    await screen.findByRole("option", { name: "/about" });
    await screen.findByRole("option", { name: "/services" });

    const pageSelect = screen.getByLabelText("Страница предпросмотра");
    fireEvent.change(pageSelect, { target: { value: "/about" } });

    await waitFor(() => {
      expect((pageSelect as HTMLSelectElement).value).toBe("/about");
      const iframe = screen.getByTitle(
        "Предпросмотр сгенерированного приложения",
      );
      expect(iframe.getAttribute("src")).toContain("about:");
    });
  });

  it("activates element picker and stores selected component", async () => {
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

    const store = createStore();
    render(
      <Provider store={store}>
        <BlazePreviewPanel activeAppId={42} />
      </Provider>,
    );

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );
    const postMessageMock = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageMock },
      configurable: true,
    });

    fireEvent.click(screen.getByTestId("toggle-component-picker-button"));

    expect(postMessageMock).toHaveBeenCalledWith(
      { type: "activate-blaze-component-selector" },
      "*",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-component-selected",
            component: {
              id: "src/App.tsx:12:5",
              name: "HeroSection",
              runtimeId: "runtime-1",
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("preview-selected-components-count").textContent,
      ).toBe("1");
    });

    expect(store.get(selectedComponentsPreviewAtom)).toEqual([
      {
        id: "src/App.tsx:12:5",
        name: "HeroSection",
        runtimeId: "runtime-1",
        relativePath: "src/App.tsx",
        lineNumber: 12,
        columnNumber: 5,
      },
    ]);
  });

  it("accepts component selection even when component name is missing", async () => {
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

    const store = createStore();
    render(
      <Provider store={store}>
        <BlazePreviewPanel activeAppId={42} />
      </Provider>,
    );

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-component-selected",
            component: {
              id: "src/App.tsx:22:3",
              runtimeId: "runtime-missing-name",
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("preview-selected-components-count").textContent,
      ).toBe("1");
    });

    expect(store.get(selectedComponentsPreviewAtom)).toEqual([
      {
        id: "src/App.tsx:22:3",
        name: "component",
        runtimeId: "runtime-missing-name",
        relativePath: "src/App.tsx",
        lineNumber: 22,
        columnNumber: 3,
      },
    ]);
  });

  it("deselects by runtime id without removing other instances", async () => {
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

    const store = createStore();
    render(
      <Provider store={store}>
        <BlazePreviewPanel activeAppId={42} />
      </Provider>,
    );

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-component-selected",
            component: {
              id: "src/App.tsx:12:5",
              name: "HeroSection",
              runtimeId: "runtime-1",
            },
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-component-selected",
            component: {
              id: "src/App.tsx:12:5",
              name: "HeroSection",
              runtimeId: "runtime-2",
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("preview-selected-components-count").textContent,
      ).toBe("2");
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-component-deselected",
            componentId: "src/App.tsx:12:5",
            runtimeId: "runtime-1",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("preview-selected-components-count").textContent,
      ).toBe("1");
    });

    expect(store.get(selectedComponentsPreviewAtom)).toEqual([
      {
        id: "src/App.tsx:12:5",
        name: "HeroSection",
        runtimeId: "runtime-2",
        relativePath: "src/App.tsx",
        lineNumber: 12,
        columnNumber: 5,
      },
    ]);
  });

  it("shows selectable elements counter while picker is active", async () => {
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

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );

    fireEvent.click(screen.getByTestId("toggle-component-picker-button"));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "blaze-selectable-components-updated",
            count: 37,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("preview-selectable-components-count").textContent,
      ).toBe("37");
    });
  });

  it("shows error state when app run fails", async () => {
    runAppMock.mockRejectedValue(new Error("Port is busy"));

    render(<BlazePreviewPanel activeAppId={55} />);

    await waitFor(() => {
      expect(
        screen.getByText("Не удалось запустить предпросмотр"),
      ).toBeTruthy();
      expect(screen.getByText("Port is busy")).toBeTruthy();
    });
  });

  it("suggests AI auto-fix attempt for a broken project start", async () => {
    runAppMock.mockRejectedValue(new Error("Build failed: TS2304"));
    const store = createStore();
    store.set(selectedChatIdAtom, 91);

    render(
      <Provider store={store}>
        <BlazePreviewPanel activeAppId={55} />
      </Provider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Не удалось запустить предпросмотр"),
      ).toBeTruthy();
      expect(screen.getByTestId("preview-autofix-button")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("preview-autofix-button"));

    await waitFor(() => {
      expect(triggerAIFixMock).toHaveBeenCalledTimes(1);
      expect(triggerAIFixMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "manual",
          incident: expect.objectContaining({
            source: "server-stderr",
            primaryError: expect.stringContaining("Build failed: TS2304"),
          }),
        }),
      );
    });
  });

  it("uses latest app chat as fallback for auto-fix when selectedChatId is empty", async () => {
    runAppMock.mockRejectedValue(new Error("Build failed: TS2304"));
    getChatsMock.mockResolvedValue([
      {
        id: 77,
        appId: 55,
        title: "latest",
        createdAt: new Date("2026-02-21T10:05:00.000Z"),
      },
    ]);

    render(<BlazePreviewPanel activeAppId={55} />);

    const button = await screen.findByTestId("preview-autofix-button");
    await waitFor(() => {
      expect(button).toBeTruthy();
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(triggerAIFixMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "manual",
          chatId: 77,
        }),
      );
    });
  });

  it("creates a chat for auto-fix when no chats exist", async () => {
    runAppMock.mockRejectedValue(new Error("Build failed: TS2304"));
    getChatsMock.mockResolvedValue([]);
    createChatMock.mockResolvedValue(555);

    render(<BlazePreviewPanel activeAppId={55} />);

    const button = await screen.findByTestId("preview-autofix-button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(createChatMock).toHaveBeenCalledWith(55);
      expect(triggerAIFixMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "manual",
          chatId: 555,
        }),
      );
    });
  });

  it("shows auto-fix suggestion for preview build errors and triggers fix", async () => {
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

    const store = createStore();
    store.set(selectedChatIdAtom, 91);

    render(
      <Provider store={store}>
        <BlazePreviewPanel activeAppId={55} />
      </Provider>,
    );

    const iframe = await screen.findByTitle(
      "Предпросмотр сгенерированного приложения",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (iframe as HTMLIFrameElement).contentWindow,
          data: {
            type: "build-error-report",
            payload: {
              message:
                'Failed to resolve import "@/src/utils/toast" from "src/pages/Index.tsx".',
              file: "src/pages/Index.tsx",
              frame: "24 | import { showSuccess } from '@/src/utils/toast'",
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("preview-runtime-autofix-button")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("preview-runtime-autofix-button"));

    await waitFor(() => {
      expect(triggerAIFixMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "manual",
          incident: expect.objectContaining({
            source: "preview-build",
            primaryError: expect.stringContaining("Failed to resolve import"),
          }),
        }),
      );
    });
  });

  it("clears in-flight auto-fix state after chat stream completion event", async () => {
    runAppMock.mockRejectedValue(new Error("Build failed: TS2304"));
    getChatsMock.mockResolvedValue([
      {
        id: 77,
        appId: 55,
        title: "latest",
        createdAt: new Date("2026-02-21T10:05:00.000Z"),
      },
    ]);
    triggerAIFixMock.mockReturnValue(true);

    render(<BlazePreviewPanel activeAppId={55} />);

    const button = await screen.findByTestId("preview-autofix-button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    act(() => {
      streamEndHandlerRef.current?.(77);
    });

    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });
});
