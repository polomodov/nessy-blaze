import {
  BACKEND_BASE_URL_STORAGE_KEY,
  BACKEND_IPC_FALLBACK_STORAGE_KEY,
  BACKEND_MODE_STORAGE_KEY,
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
    delete window.__BLAZE_REMOTE_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    window.__BLAZE_REMOTE_CONFIG__ = {
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
      "https://api.example.com/api/v1/orgs/me/workspaces/me/apps",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(fallback.invokeMock).not.toHaveBeenCalled();
  });

  it("uses API route mapping for settings reads", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
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

  it("uses API route mapping for workspace creation", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };

    const fallback = new MockIpcRenderer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "ws_123",
            organizationId: "org_123",
            slug: "new-space",
            name: "New Space",
            type: "team",
            createdByUserId: "user_123",
            createdAt: "2026-02-19T10:00:00.000Z",
            updatedAt: "2026-02-19T10:00:00.000Z",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport(fallback);
    const workspace = await client.invoke("create-workspace", {
      orgId: "org_123",
      name: "New Space",
      slug: "new-space",
      type: "team",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/orgs/org_123/workspaces",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "New Space",
          slug: "new-space",
          type: "team",
        }),
      }),
    );
    expect(workspace).toEqual({
      id: "ws_123",
      organizationId: "org_123",
      slug: "new-space",
      name: "New Space",
      type: "team",
      createdByUserId: "user_123",
      createdAt: "2026-02-19T10:00:00.000Z",
      updatedAt: "2026-02-19T10:00:00.000Z",
    });
    expect(fallback.invokeMock).not.toHaveBeenCalled();
  });

  it("falls back to IPC when HTTP request fails", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
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

  it("retries browser requests with window origin when configured backend URL is unreachable", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new BrowserBackendClient();
    const result = await client.invoke("list-apps");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/v1/orgs/me/workspaces/me/apps",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${window.location.origin}/api/v1/orgs/me/workspaces/me/apps`,
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("forces IPC for streaming channels in HTTP mode", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
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
