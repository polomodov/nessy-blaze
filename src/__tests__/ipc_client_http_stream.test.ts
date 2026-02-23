import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcClient } from "@/ipc/ipc_client";
import { BACKEND_BASE_URL_STORAGE_KEY } from "@/ipc/backend_client";

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

describe("IpcClient HTTP stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).electron;
    delete window.__BLAZE_REMOTE_CONFIG__;
    const storage = window.localStorage as Partial<Storage> &
      Record<string, unknown>;
    if (typeof storage.removeItem === "function") {
      storage.removeItem(BACKEND_BASE_URL_STORAGE_KEY);
    } else {
      delete storage[BACKEND_BASE_URL_STORAGE_KEY];
    }
    (IpcClient as any).instance = undefined;
  });

  it("parses SSE chunk/end events", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createSseResponse([
          [
            "event: chat:response:chunk",
            'data: {"chatId":77,"messages":[{"id":1,"role":"user","content":"Build a page"},{"id":2,"role":"assistant","content":"Drafting..."}]}',
            "",
            "",
          ].join("\n"),
          [
            "event: chat:response:end",
            'data: {"chatId":77,"updatedFiles":false}',
            "",
            "",
          ].join("\n"),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = IpcClient.getInstance();
    const onUpdate = vi.fn();
    const onError = vi.fn();

    await new Promise<void>((resolve) => {
      client.streamMessage("Build a page", {
        chatId: 77,
        onUpdate,
        onEnd: (payload) => {
          expect(payload.chatId).toBe(77);
          resolve();
        },
        onError,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/orgs/me/workspaces/me/chats/77/stream",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith([
      { id: 1, role: "user", content: "Build a page" },
      { id: 2, role: "assistant", content: "Drafting..." },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces streaming errors without IPC fallback", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const invokeMock = vi.fn();
    (window as any).electron = {
      ipcRenderer: {
        invoke: invokeMock,
        on: vi.fn().mockReturnValue(() => {}),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const client = IpcClient.getInstance();
    const onError = vi.fn();

    client.streamMessage("Build a page", {
      chatId: 99,
      onUpdate: vi.fn(),
      onEnd: vi.fn(),
      onError,
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("retries stream request with window origin when configured URL is unreachable", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        createSseResponse([
          [
            "event: chat:response:end",
            'data: {"chatId":44,"updatedFiles":false}',
            "",
            "",
          ].join("\n"),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = IpcClient.getInstance();
    const onError = vi.fn();

    await new Promise<void>((resolve) => {
      client.streamMessage("Retry stream", {
        chatId: 44,
        onUpdate: vi.fn(),
        onEnd: () => resolve(),
        onError,
      });
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/v1/orgs/me/workspaces/me/chats/44/stream",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${window.location.origin}/api/v1/orgs/me/workspaces/me/chats/44/stream`,
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns actionable stream error message when network fetch fails", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: window.location.origin,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const client = IpcClient.getInstance();
    const onError = vi.fn();

    client.streamMessage("Build a page", {
      chatId: 123,
      onUpdate: vi.fn(),
      onEnd: vi.fn(),
      onError,
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unable to reach backend chat stream endpoint.",
        ),
      );
    });
  });

  it("emits preview url output when run-app returns HTTP payload", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              previewUrl: "http://127.0.0.1:32142",
              originalUrl: "http://127.0.0.1:32142",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const client = IpcClient.getInstance();
    const onOutput = vi.fn();

    await client.runApp(42, onOutput);

    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stdout",
        appId: 42,
        message:
          "[blaze-proxy-server]started=[http://127.0.0.1:32142] original=[http://127.0.0.1:32142]",
      }),
    );
  });
});
