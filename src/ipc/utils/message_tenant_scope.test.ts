import { describe, expect, it } from "vitest";
import { resolveMessageTenantScope } from "./message_tenant_scope";

describe("resolveMessageTenantScope", () => {
  it("prefers chat scope fields", () => {
    expect(
      resolveMessageTenantScope({
        chat: {
          organizationId: "org-chat",
          workspaceId: "ws-chat",
          createdByUserId: "user-chat",
        },
        app: {
          organizationId: "org-app",
          workspaceId: "ws-app",
          createdByUserId: "user-app",
        },
      }),
    ).toEqual({
      organizationId: "org-chat",
      workspaceId: "ws-chat",
      createdByUserId: "user-chat",
    });
  });

  it("falls back to app scope when chat scope is missing", () => {
    expect(
      resolveMessageTenantScope({
        chat: {
          organizationId: null,
          workspaceId: null,
          createdByUserId: null,
        },
        app: {
          organizationId: "org-app",
          workspaceId: "ws-app",
          createdByUserId: "user-app",
        },
      }),
    ).toEqual({
      organizationId: "org-app",
      workspaceId: "ws-app",
      createdByUserId: "user-app",
    });
  });

  it("returns null fields when both chat and app scope are missing", () => {
    expect(
      resolveMessageTenantScope({
        chat: {},
        app: {},
      }),
    ).toEqual({
      organizationId: null,
      workspaceId: null,
      createdByUserId: null,
    });
  });
});
