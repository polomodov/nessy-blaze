import { describe, expect, it } from "vitest";
import type { TenantOrganization, TenantWorkspace } from "@/ipc/ipc_types";
import {
  resolveActiveOrganizationId,
  resolveActiveWorkspaceId,
} from "./tenant_scope_utils";

const organizations: TenantOrganization[] = [
  {
    id: "org-a",
    slug: "org-a",
    name: "Org A",
    role: "owner",
    status: "active",
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "org-b",
    slug: "org-b",
    name: "Org B",
    role: "member",
    status: "active",
    createdAt: null,
    updatedAt: null,
  },
];

const workspaces: TenantWorkspace[] = [
  {
    id: "ws-team",
    organizationId: "org-a",
    slug: "team",
    name: "Team Workspace",
    type: "team",
    createdByUserId: null,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "ws-personal",
    organizationId: "org-a",
    slug: "personal",
    name: "Personal Workspace",
    type: "personal",
    createdByUserId: null,
    createdAt: null,
    updatedAt: null,
  },
];

describe("tenant_scope_utils", () => {
  it("returns current organization when it is available", () => {
    expect(resolveActiveOrganizationId(organizations, "org-b")).toBe("org-b");
  });

  it("falls back to first organization when current organization is missing", () => {
    expect(resolveActiveOrganizationId(organizations, "org-x")).toBe("org-a");
  });

  it("returns null when organization list is empty", () => {
    expect(resolveActiveOrganizationId([], "org-a")).toBeNull();
  });

  it("returns current workspace when it is available", () => {
    expect(resolveActiveWorkspaceId(workspaces, "ws-team")).toBe("ws-team");
  });

  it("falls back to personal workspace when current workspace is missing", () => {
    expect(resolveActiveWorkspaceId(workspaces, "ws-missing")).toBe(
      "ws-personal",
    );
  });

  it("falls back to first workspace when there is no personal workspace", () => {
    expect(
      resolveActiveWorkspaceId(
        workspaces.filter((workspace) => workspace.type === "team"),
        "ws-missing",
      ),
    ).toBe("ws-team");
  });

  it("returns null when workspace list is empty", () => {
    expect(resolveActiveWorkspaceId([], "ws-team")).toBeNull();
  });
});
