import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, BriefcaseBusiness } from "lucide-react";
import { cn } from "@/lib/utils";
import { IpcClient } from "@/ipc/ipc_client";
import {
  getConfiguredBackendMode,
  getConfiguredTenantScope,
  TENANT_ORG_ID_STORAGE_KEY,
  TENANT_WORKSPACE_ID_STORAGE_KEY,
} from "@/ipc/backend_client";
import type { TenantOrganization, TenantWorkspace } from "@/ipc/ipc_types";
import {
  resolveActiveOrganizationId,
  resolveActiveWorkspaceId,
} from "./tenant_scope_utils";

const TENANT_QUERY_KEYS = {
  organizations: ["tenant", "organizations"] as const,
  workspaces: (orgId: string) => ["tenant", "workspaces", orgId] as const,
};

interface TenantScopePickerProps {
  onScopeChange?: () => Promise<void> | void;
}

export function TenantScopePicker({ onScopeChange }: TenantScopePickerProps) {
  const [scope, setScope] = useState(() => getConfiguredTenantScope());
  const [isSwitchingScope, setIsSwitchingScope] = useState(false);
  const isHttpBackend = getConfiguredBackendMode() === "http";

  const organizationsQuery = useQuery<TenantOrganization[], Error>({
    queryKey: TENANT_QUERY_KEYS.organizations,
    enabled: isHttpBackend,
    retry: 0,
    queryFn: async () => {
      return IpcClient.getInstance().listOrganizations();
    },
    meta: { showErrorToast: false },
  });

  const organizations = organizationsQuery.data ?? [];
  const hasConfiguredOrganization = organizations.some(
    (organization) => organization.id === scope.orgId,
  );
  const activeOrgId = useMemo(() => {
    return resolveActiveOrganizationId(organizations, scope.orgId);
  }, [organizations, scope.orgId]);

  const workspacesQuery = useQuery<TenantWorkspace[], Error>({
    queryKey: TENANT_QUERY_KEYS.workspaces(activeOrgId ?? "none"),
    enabled: isHttpBackend && Boolean(activeOrgId),
    retry: 0,
    queryFn: async () => {
      return IpcClient.getInstance().listWorkspaces({
        orgId: activeOrgId ?? undefined,
      });
    },
    meta: { showErrorToast: false },
  });

  const workspaces = workspacesQuery.data ?? [];
  const hasConfiguredWorkspace = workspaces.some(
    (workspace) => workspace.id === scope.workspaceId,
  );
  const activeWorkspaceId = useMemo(() => {
    return resolveActiveWorkspaceId(workspaces, scope.workspaceId);
  }, [workspaces, scope.workspaceId]);

  const applyScope = useCallback(
    async (orgId: string, workspaceId: string) => {
      window.localStorage.setItem(TENANT_ORG_ID_STORAGE_KEY, orgId);
      window.localStorage.setItem(TENANT_WORKSPACE_ID_STORAGE_KEY, workspaceId);
      setScope({ orgId, workspaceId });
      await onScopeChange?.();
    },
    [onScopeChange],
  );

  const handleOrganizationClick = async (orgId: string) => {
    if (isSwitchingScope || orgId === activeOrgId) {
      return;
    }
    setIsSwitchingScope(true);
    try {
      await applyScope(orgId, "me");
    } finally {
      setIsSwitchingScope(false);
    }
  };

  const handleWorkspaceClick = async (workspaceId: string) => {
    if (isSwitchingScope || !activeOrgId || workspaceId === activeWorkspaceId) {
      return;
    }
    setIsSwitchingScope(true);
    try {
      await applyScope(activeOrgId, workspaceId);
    } finally {
      setIsSwitchingScope(false);
    }
  };

  useEffect(() => {
    if (!activeOrgId || isSwitchingScope) {
      return;
    }
    if (scope.orgId === "me" || hasConfiguredOrganization) {
      return;
    }

    setIsSwitchingScope(true);
    void applyScope(activeOrgId, "me").finally(() => {
      setIsSwitchingScope(false);
    });
  }, [
    activeOrgId,
    applyScope,
    hasConfiguredOrganization,
    isSwitchingScope,
    scope.orgId,
  ]);

  useEffect(() => {
    if (!activeOrgId || !activeWorkspaceId || isSwitchingScope) {
      return;
    }
    if (scope.workspaceId === "me" || hasConfiguredWorkspace) {
      return;
    }

    setIsSwitchingScope(true);
    void applyScope(activeOrgId, activeWorkspaceId).finally(() => {
      setIsSwitchingScope(false);
    });
  }, [
    activeOrgId,
    activeWorkspaceId,
    applyScope,
    hasConfiguredWorkspace,
    isSwitchingScope,
    scope.workspaceId,
  ]);

  if (!isHttpBackend) {
    return null;
  }

  return (
    <div
      className="mx-2 rounded-lg border border-sidebar-border/80 p-2 space-y-2"
      data-testid="tenant-scope-picker"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Tenant Scope
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>Organizations</span>
        </div>

        {organizationsQuery.isLoading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Loading organizations...
          </div>
        ) : organizationsQuery.error ? (
          <div className="px-2 py-1 text-xs text-red-500">
            Failed to load organizations
          </div>
        ) : organizations.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No organizations found
          </div>
        ) : (
          organizations.map((organization) => {
            const isActive = organization.id === activeOrgId;
            return (
              <button
                key={organization.id}
                type="button"
                disabled={isSwitchingScope}
                onClick={() => {
                  void handleOrganizationClick(organization.id);
                }}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-sidebar-accent/80 disabled:opacity-60",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "",
                )}
              >
                <div className="truncate">{organization.name}</div>
              </button>
            );
          })
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <BriefcaseBusiness className="h-3.5 w-3.5" />
          <span>Workspaces</span>
        </div>

        {workspacesQuery.isLoading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Loading workspaces...
          </div>
        ) : workspacesQuery.error ? (
          <div className="px-2 py-1 text-xs text-red-500">
            Failed to load workspaces
          </div>
        ) : workspaces.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No workspaces found
          </div>
        ) : (
          workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId;
            return (
              <button
                key={workspace.id}
                type="button"
                disabled={isSwitchingScope}
                onClick={() => {
                  void handleWorkspaceClick(workspace.id);
                }}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-sidebar-accent/80 disabled:opacity-60",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{workspace.name}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {workspace.type}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
