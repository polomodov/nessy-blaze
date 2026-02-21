import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcClient } from "@/ipc/ipc_client";

describe("IpcClient tenant collections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).electron;
    delete window.__BLAZE_REMOTE_CONFIG__;
    (IpcClient as any).instance = undefined;
  });

  it("normalizes wrapped organization and workspace payloads", async () => {
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
            data: {
              organizations: [
                {
                  id: "org_1",
                  slug: "org-1",
                  name: "Org One",
                  role: "owner",
                  status: "active",
                  createdAt: "2026-02-20T00:00:00.000Z",
                  updatedAt: "2026-02-20T00:00:00.000Z",
                },
              ],
            },
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
        new Response(
          JSON.stringify({
            data: {
              workspaces: [
                {
                  id: "ws_1",
                  organizationId: "org_1",
                  slug: "ws-1",
                  name: "Workspace One",
                  type: "personal",
                  createdByUserId: "user_1",
                  createdAt: "2026-02-20T00:00:00.000Z",
                  updatedAt: "2026-02-20T00:00:00.000Z",
                },
              ],
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

    const client = IpcClient.getInstance();
    const organizations = await client.listOrganizations();
    const workspaces = await client.listWorkspaces({ orgId: "org_1" });

    expect(organizations).toEqual([
      expect.objectContaining({
        id: "org_1",
      }),
    ]);
    expect(workspaces).toEqual([
      expect.objectContaining({
        id: "ws_1",
      }),
    ]);
  });
});
