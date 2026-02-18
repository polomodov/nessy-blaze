import { describe, expect, it } from "vitest";
import type { RequestContext } from "./request_context";
import { requireRoleForMutation } from "./request_context";

function createContext(role: RequestContext["workspaceRole"]): RequestContext {
  return {
    userId: "user-1",
    externalSub: "dev-user",
    email: "dev@example.com",
    displayName: "Dev",
    orgId: "org-1",
    workspaceId: "ws-1",
    organizationRole: role,
    workspaceRole: role,
    roles: [role],
    authSource: "dev-bypass",
  };
}

describe("requireRoleForMutation", () => {
  it("allows owner/admin/member and blocks viewer", () => {
    expect(() => requireRoleForMutation(createContext("owner"))).not.toThrow();
    expect(() => requireRoleForMutation(createContext("admin"))).not.toThrow();
    expect(() => requireRoleForMutation(createContext("member"))).not.toThrow();
    expect(() => requireRoleForMutation(createContext("viewer"))).toThrow(
      "Viewer role is read-only",
    );
  });
});
