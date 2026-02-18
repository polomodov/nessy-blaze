import type { TenantOrganization, TenantWorkspace } from "@/ipc/ipc_types";

export function resolveActiveOrganizationId(
  organizations: TenantOrganization[],
  currentOrgId: string,
): string | null {
  if (organizations.length === 0) {
    return null;
  }

  if (organizations.some((org) => org.id === currentOrgId)) {
    return currentOrgId;
  }

  return organizations[0]?.id ?? null;
}

export function resolveActiveWorkspaceId(
  workspaces: TenantWorkspace[],
  currentWorkspaceId: string,
): string | null {
  if (workspaces.length === 0) {
    return null;
  }

  if (workspaces.some((workspace) => workspace.id === currentWorkspaceId)) {
    return currentWorkspaceId;
  }

  const personalWorkspace = workspaces.find(
    (workspace) => workspace.type === "personal",
  );
  if (personalWorkspace) {
    return personalWorkspace.id;
  }

  return workspaces[0]?.id ?? null;
}
