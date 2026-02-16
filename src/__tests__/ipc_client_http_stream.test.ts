import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcClient } from "@/ipc/ipc_client";
import {
  BACKEND_BASE_URL_STORAGE_KEY,
  BACKEND_IPC_FALLBACK_STORAGE_KEY,
  BACKEND_MODE_STORAGE_KEY,
} from "@/ipc/backend_client";

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
    delete window.__DYAD_REMOTE_CONFIG__;
    const storage = window.localStorage as Partial<Storage> &
      Record<string, unknown>;
    if (typeof storage.removeItem === "function") {
      storage.removeItem(BACKEND_MODE_STORAGE_KEY);
      storage.removeItem(BACKEND_BASE_URL_STORAGE_KEY);
      storage.removeItem(BACKEND_IPC_FALLBACK_STORAGE_KEY);
    } else {
      delete storage[BACKEND_MODE_STORAGE_KEY];
      delete storage[BACKEND_BASE_URL_STORAGE_KEY];
      delete storage[BACKEND_IPC_FALLBACK_STORAGE_KEY];
    }
    (IpcClient as any).instance = undefined;
  });

  it("parses SSE chunk/end events in HTTP mode", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
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
      "https://api.example.com/api/v1/chats/77/stream",
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
});
