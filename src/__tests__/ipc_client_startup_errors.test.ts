import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
}));

describe("IpcClient startup read errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).electron;
    (IpcClient as any).instance = undefined;
  });

  it("does not show toast for getUserSettings bootstrap failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Not Found", {
          status: 404,
          headers: {
            "content-type": "text/plain",
          },
        }),
      ),
    );

    const client = IpcClient.getInstance();
    await expect(client.getUserSettings()).rejects.toThrow(
      'Backend API failed for "get-user-settings"',
    );
    expect(showError).not.toHaveBeenCalled();
  });

  it("does not show toast for getEnvVars bootstrap failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Not Found", {
          status: 404,
          headers: {
            "content-type": "text/plain",
          },
        }),
      ),
    );

    const client = IpcClient.getInstance();
    await expect(client.getEnvVars()).rejects.toThrow(
      'Backend API failed for "get-env-vars"',
    );
    expect(showError).not.toHaveBeenCalled();
  });

  it("parses getChats date fields from HTTP payload", async () => {
    window.__DYAD_REMOTE_CONFIG__ = {
      backendClient: {
        mode: "http",
        baseUrl: "https://api.example.com",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 1,
                appId: 42,
                title: null,
                createdAt: "2026-02-01T00:00:00.000Z",
              },
            ],
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
    const chats = await client.getChats();

    expect(chats).toHaveLength(1);
    expect(chats[0].createdAt).toBeInstanceOf(Date);
  });
});
