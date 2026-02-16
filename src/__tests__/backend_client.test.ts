import {
  BrowserBackendClient,
  createBackendClientTransport,
  HttpBackendClient,
  IpcBackendClient,
  type BackendClient,
} from "@/ipc/backend_client";
import { describe, it, expect, beforeEach, vi } from "vitest";

class MockIpcRenderer implements BackendClient {
  public invokeMock = vi.fn();

  public invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
    this.invokeMock(channel, ...args);
    return Promise.resolve({
      transport: "ipc",
      channel,
      args,
    } as T);
  }

  public on = vi.fn(() => vi.fn());

  public removeAllListeners = vi.fn();

  public removeListener = vi.fn();
}

describe("backend_client transport", () => {
  beforeEach(() => {
    delete window.__DYAD_REMOTE_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses IPC transport by default", async () => {
    const fallback = new MockIpcRenderer();
    const client = createBackendClientTransport(fallback);

    expect(client).toBeInstanceOf(IpcBackendClient);
    await client.invoke("list-apps");
    expect(fallback.invokeMock).toHaveBeenCalledWith("list-apps");
  });

  it("uses browser transport when Electron bridge is missing", async () => {
    const client = createBackendClientTransport();
    expect(client).toBeInstanceOf(BrowserBackendClient);
  });

  it("uses HTTP transport when mode is http", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };
    const fallback = new MockIpcRenderer();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport(fallback);
    expect(client).toBeInstanceOf(HttpBackendClient);

    const result = await client.invoke("list-apps");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/apps",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(fallback.invokeMock).not.toHaveBeenCalled();
  });

  it("uses API route mapping for settings reads", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };

    const fallback = new MockIpcRenderer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { telemetryConsent: "unset" } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport(fallback);
    const settings = await client.invoke("get-user-settings");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/user/settings",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(settings).toEqual({ telemetryConsent: "unset" });
    expect(fallback.invokeMock).not.toHaveBeenCalled();
  });

  it("falls back to IPC when HTTP request fails", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };
    const fallback = new MockIpcRenderer();

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport(fallback);
    const result = await client.invoke("list-apps", { page: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fallback.invokeMock).toHaveBeenCalledWith("list-apps", { page: 1 });
    expect(result).toEqual({
      transport: "ipc",
      channel: "list-apps",
      args: [{ page: 1 }],
    });
  });

  it("forces IPC for streaming channels in HTTP mode", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };
    const fallback = new MockIpcRenderer();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport(fallback);
    await client.invoke("chat:stream", { chatId: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fallback.invokeMock).toHaveBeenCalledWith("chat:stream", {
      chatId: 1,
    });
  });
});
