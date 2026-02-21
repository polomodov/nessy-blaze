import {
  AUTH_REDIRECT_REASON_SESSION_EXPIRED,
  AUTH_REDIRECT_REASON_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  BACKEND_BASE_URL_STORAGE_KEY,
  BrowserBackendClient,
  createBackendClientTransport,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
  FeatureDisabledError,
} from "@/ipc/backend_client";
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("backend_client transport", () => {
  beforeEach(() => {
    delete window.__BLAZE_REMOTE_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const storage = window.localStorage as Partial<Storage> &
      Record<string, unknown>;
    if (typeof storage.removeItem === "function") {
      storage.removeItem(BACKEND_BASE_URL_STORAGE_KEY);
      storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      storage.removeItem(DEV_USER_SUB_STORAGE_KEY);
      storage.removeItem(DEV_USER_EMAIL_STORAGE_KEY);
      storage.removeItem(DEV_USER_NAME_STORAGE_KEY);
    } else {
      delete storage[BACKEND_BASE_URL_STORAGE_KEY];
      delete storage[AUTH_TOKEN_STORAGE_KEY];
      delete storage[DEV_USER_SUB_STORAGE_KEY];
      delete storage[DEV_USER_EMAIL_STORAGE_KEY];
      delete storage[DEV_USER_NAME_STORAGE_KEY];
    }
    window.sessionStorage.removeItem(AUTH_REDIRECT_REASON_STORAGE_KEY);
  });

  it("uses browser HTTP transport", () => {
    const client = createBackendClientTransport();
    expect(client).toBeInstanceOf(BrowserBackendClient);
  });

  it("uses API route mapping for list-apps", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport();
    const result = await client.invoke("list-apps");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/orgs/me/workspaces/me/apps",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("routes proposal and file-read core endpoints", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { chatId: 77, messageId: 99, proposal: null },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "<div>Hello</div>" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport();

    await client.invoke("get-proposal", { chatId: 77 });
    await client.invoke("read-app-file", {
      appId: 42,
      filePath: "src/App.tsx",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/v1/orgs/me/workspaces/me/chats/77/proposal",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/api/v1/orgs/me/workspaces/me/apps/42/file?path=src%2FApp.tsx",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("routes revert-version to dedicated HTTP endpoint", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { successMessage: "Restored version" },
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

    const client = createBackendClientTransport();
    const result = await client.invoke("revert-version", {
      appId: 7,
      previousVersionId: "abc123",
      currentChatMessageId: { chatId: 88, messageId: 9 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/orgs/me/workspaces/me/apps/7/versions/revert",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          appId: 7,
          previousVersionId: "abc123",
          currentChatMessageId: { chatId: 88, messageId: 9 },
        }),
      }),
    );
    expect(result).toEqual({ successMessage: "Restored version" });
  });

  it("clears auth context and redirects to /auth when JWT is expired", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const assignMock = vi
      .spyOn(window.location, "assign")
      .mockImplementation((_value: string | URL) => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "JWT is expired" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendClientTransport();
    await expect(client.invoke("get-chats")).rejects.toThrow(
      "Authentication session expired. Please sign in again.",
    );

    expect(assignMock).toHaveBeenCalledWith("/auth");
    expect(
      window.sessionStorage.getItem(AUTH_REDIRECT_REASON_STORAGE_KEY),
    ).toBe(AUTH_REDIRECT_REASON_SESSION_EXPIRED);
  });

  it("retries browser requests with window origin when configured backend URL is unreachable", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
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

  it("returns controlled error for unmapped channels", async () => {
    window.__BLAZE_REMOTE_CONFIG__ = {
      backendClient: {
        baseUrl: "https://api.example.com",
      },
    };

    const client = createBackendClientTransport();
    await expect(
      client.invoke("open-external-url", "https://example.com"),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
  });
});
