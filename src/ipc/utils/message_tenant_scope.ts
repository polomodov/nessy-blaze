type TenantScopedEntity = {
  organizationId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
};

export function resolveMessageTenantScope(params: {
  chat: TenantScopedEntity;
  app: TenantScopedEntity;
}) {
  return {
    organizationId:
      params.chat.organizationId ?? params.app.organizationId ?? null,
    workspaceId: params.chat.workspaceId ?? params.app.workspaceId ?? null,
    createdByUserId:
      params.chat.createdByUserId ?? params.app.createdByUserId ?? null,
  };
}
