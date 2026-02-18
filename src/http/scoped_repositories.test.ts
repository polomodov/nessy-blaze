import { describe, expect, it } from "vitest";
import { listAppsForScope } from "./scoped_repositories";

describe("scoped repositories", () => {
  it("rejects missing tenant scope", async () => {
    await expect(
      listAppsForScope({
        userId: "user-1",
        externalSub: "dev-user",
        email: "dev@example.com",
        displayName: "Dev",
        orgId: "",
        workspaceId: "",
        organizationRole: "owner",
        workspaceRole: "owner",
        roles: ["owner"],
        authSource: "dev-bypass",
      }),
    ).rejects.toThrow("organizationId/workspaceId scope is required");
  });
});
