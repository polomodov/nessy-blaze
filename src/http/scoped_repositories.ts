import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db, initializeDatabase } from "../db";
import {
  apps,
  chats,
  messages,
  organizationMemberships,
  organizations,
  workspaces,
} from "../db/schema";
import type { RequestContext } from "./request_context";
import { HttpError } from "./http_errors";

function toIsoDate(
  value: Date | number | string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString();
  }

  return null;
}

function assertTenantScope(
  context: Pick<RequestContext, "orgId" | "workspaceId">,
) {
  if (!context.orgId || !context.workspaceId) {
    throw new HttpError(
      400,
      "TENANT_SCOPE_REQUIRED",
      "organizationId/workspaceId scope is required",
    );
  }
}

function mapAppRow(row: typeof apps.$inferSelect) {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    name: String(row.name ?? ""),
    path: String(row.path ?? ""),
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    githubOrg: row.githubOrg ?? null,
    githubRepo: row.githubRepo ?? null,
    githubBranch: row.githubBranch ?? null,
    supabaseProjectId: row.supabaseProjectId ?? null,
    supabaseParentProjectId: row.supabaseParentProjectId ?? null,
    supabaseProjectName: null,
    supabaseOrganizationSlug: row.supabaseOrganizationSlug ?? null,
    neonProjectId: row.neonProjectId ?? null,
    neonDevelopmentBranchId: row.neonDevelopmentBranchId ?? null,
    neonPreviewBranchId: row.neonPreviewBranchId ?? null,
    vercelProjectId: row.vercelProjectId ?? null,
    vercelProjectName: row.vercelProjectName ?? null,
    vercelTeamSlug: null,
    vercelDeploymentUrl: row.vercelDeploymentUrl ?? null,
    installCommand: row.installCommand ?? null,
    startCommand: row.startCommand ?? null,
    isFavorite: Boolean(row.isFavorite),
  };
}

function mapChatRow(row: typeof chats.$inferSelect) {
  return {
    id: Number(row.id),
    appId: Number(row.appId),
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    title: row.title ?? null,
    initialCommitHash: row.initialCommitHash ?? null,
    createdAt: toIsoDate(row.createdAt),
  };
}

function mapMessageRow(row: typeof messages.$inferSelect) {
  return {
    id: Number(row.id),
    chatId: Number(row.chatId),
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content ?? ""),
    approvalState: row.approvalState ?? null,
    sourceCommitHash: row.sourceCommitHash ?? null,
    commitHash: row.commitHash ?? null,
    requestId: row.requestId ?? null,
    maxTokensUsed: row.maxTokensUsed == null ? null : Number(row.maxTokensUsed),
    model: row.model ?? null,
    aiMessagesJson: row.aiMessagesJson ?? null,
    createdAt: toIsoDate(row.createdAt),
  };
}

async function ensureOrganizationAccess(
  userId: string,
  organizationId: string,
): Promise<void> {
  const [membership] = await db
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "No active membership in organization",
    );
  }
}

export async function listOrganizationsForUser(userId: string) {
  await initializeDatabase();
  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizationMemberships.organizationId, organizations.id),
    )
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .orderBy(asc(organizations.createdAt));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  }));
}

export async function getOrganizationByIdForUser(params: {
  userId: string;
  orgId: string;
}) {
  await initializeDatabase();
  const [row] = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizationMemberships.organizationId, organizations.id),
    )
    .where(
      and(
        eq(organizationMemberships.userId, params.userId),
        eq(organizationMemberships.organizationId, params.orgId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HttpError(404, "ORG_NOT_FOUND", "Organization not found");
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  };
}

export async function listWorkspacesForScope(context: RequestContext) {
  await initializeDatabase();
  assertTenantScope(context);
  await ensureOrganizationAccess(context.userId, context.orgId);

  const rows = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      slug: workspaces.slug,
      name: workspaces.name,
      type: workspaces.type,
      createdByUserId: workspaces.createdByUserId,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.organizationId, context.orgId))
    .orderBy(asc(workspaces.createdAt));

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    type: row.type,
    createdByUserId: row.createdByUserId,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
  }));
}

export async function listAppsForScope(context: RequestContext) {
  assertTenantScope(context);
  await initializeDatabase();
  const rows = await db
    .select()
    .from(apps)
    .where(
      and(
        eq(apps.organizationId, context.orgId),
        eq(apps.workspaceId, context.workspaceId),
      ),
    )
    .orderBy(desc(apps.createdAt));
  return rows.map(mapAppRow);
}

export async function searchAppsForScope(
  context: RequestContext,
  searchQuery: string,
) {
  assertTenantScope(context);
  await initializeDatabase();
  const rows = await db
    .select({
      id: apps.id,
      organizationId: apps.organizationId,
      workspaceId: apps.workspaceId,
      createdByUserId: apps.createdByUserId,
      name: apps.name,
      createdAt: apps.createdAt,
    })
    .from(apps)
    .where(
      and(
        eq(apps.organizationId, context.orgId),
        eq(apps.workspaceId, context.workspaceId),
        ilike(apps.name, `%${searchQuery}%`),
      ),
    )
    .orderBy(desc(apps.createdAt));

  return rows.map((row) => ({
    id: Number(row.id),
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    name: row.name,
    createdAt: toIsoDate(row.createdAt),
    matchedChatTitle: null,
    matchedChatMessage: null,
  }));
}

export async function getAppByIdForScope(
  context: RequestContext,
  appId: number,
) {
  assertTenantScope(context);
  await initializeDatabase();
  const row = await db.query.apps.findFirst({
    where: and(
      eq(apps.id, appId),
      eq(apps.organizationId, context.orgId),
      eq(apps.workspaceId, context.workspaceId),
    ),
  });
  if (!row) {
    throw new HttpError(404, "APP_NOT_FOUND", "App not found");
  }
  return mapAppRow(row);
}

export async function createAppRecordForScope(params: {
  context: RequestContext;
  name: string;
  path: string;
  initialCommitHash: string | null;
}) {
  assertTenantScope(params.context);
  await initializeDatabase();

  const { appRow, chatId } = await db.transaction(async (tx) => {
    const [createdApp] = await tx
      .insert(apps)
      .values({
        organizationId: params.context.orgId,
        workspaceId: params.context.workspaceId,
        createdByUserId: params.context.userId,
        name: params.name,
        path: params.path,
        isFavorite: false,
      })
      .returning();

    const [createdChat] = await tx
      .insert(chats)
      .values({
        organizationId: params.context.orgId,
        workspaceId: params.context.workspaceId,
        createdByUserId: params.context.userId,
        appId: createdApp.id,
        title: null,
        initialCommitHash: params.initialCommitHash,
      })
      .returning({ id: chats.id });

    return {
      appRow: createdApp,
      chatId: Number(createdChat.id),
    };
  });

  return {
    app: mapAppRow(appRow),
    chatId,
  };
}

export async function toggleAppFavoriteForScope(
  context: RequestContext,
  appId: number,
): Promise<{ isFavorite: boolean }> {
  assertTenantScope(context);
  await initializeDatabase();

  const row = await db.query.apps.findFirst({
    where: and(
      eq(apps.id, appId),
      eq(apps.organizationId, context.orgId),
      eq(apps.workspaceId, context.workspaceId),
    ),
    columns: {
      isFavorite: true,
    },
  });
  if (!row) {
    throw new HttpError(404, "APP_NOT_FOUND", "App not found");
  }

  const nextFavoriteState = !row.isFavorite;
  await db
    .update(apps)
    .set({
      isFavorite: nextFavoriteState,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(apps.id, appId),
        eq(apps.organizationId, context.orgId),
        eq(apps.workspaceId, context.workspaceId),
      ),
    );

  return { isFavorite: nextFavoriteState };
}

export async function listChatsForScope(
  context: RequestContext,
  appId?: number,
) {
  assertTenantScope(context);
  await initializeDatabase();

  const conditions = [
    eq(chats.organizationId, context.orgId),
    eq(chats.workspaceId, context.workspaceId),
  ];
  if (typeof appId === "number") {
    conditions.push(eq(chats.appId, appId));
  }

  const rows = await db
    .select()
    .from(chats)
    .where(and(...conditions))
    .orderBy(desc(chats.createdAt));

  return rows.map(mapChatRow);
}

export async function createChatForScope(
  context: RequestContext,
  appId: number,
) {
  assertTenantScope(context);
  await initializeDatabase();

  const appExists = await db
    .select({ id: apps.id })
    .from(apps)
    .where(
      and(
        eq(apps.id, appId),
        eq(apps.organizationId, context.orgId),
        eq(apps.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (appExists.length === 0) {
    throw new HttpError(404, "APP_NOT_FOUND", "App not found");
  }

  const [inserted] = await db
    .insert(chats)
    .values({
      organizationId: context.orgId,
      workspaceId: context.workspaceId,
      createdByUserId: context.userId,
      appId,
      title: null,
      initialCommitHash: null,
    })
    .returning({ id: chats.id });
  return Number(inserted.id);
}

export async function getChatForScope(context: RequestContext, chatId: number) {
  assertTenantScope(context);
  await initializeDatabase();

  const chatRow = await db.query.chats.findFirst({
    where: and(
      eq(chats.id, chatId),
      eq(chats.organizationId, context.orgId),
      eq(chats.workspaceId, context.workspaceId),
    ),
    columns: {
      id: true,
      appId: true,
      title: true,
      initialCommitHash: true,
      createdAt: true,
      organizationId: true,
      workspaceId: true,
      createdByUserId: true,
    },
  });
  if (!chatRow) {
    throw new HttpError(404, "CHAT_NOT_FOUND", "Chat not found");
  }

  await db
    .update(messages)
    .set({
      organizationId: context.orgId,
      workspaceId: context.workspaceId,
    })
    .where(
      and(
        eq(messages.chatId, chatId),
        or(isNull(messages.organizationId), isNull(messages.workspaceId)),
      ),
    );

  const messageRows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(messages.organizationId, context.orgId),
        eq(messages.workspaceId, context.workspaceId),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return {
    ...mapChatRow(chatRow as typeof chats.$inferSelect),
    messages: messageRows.map(mapMessageRow),
  };
}

export async function ensureChatInScope(
  context: RequestContext,
  chatId: number,
) {
  assertTenantScope(context);
  await initializeDatabase();
  const [chat] = await db
    .select({ id: chats.id, appId: chats.appId })
    .from(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.organizationId, context.orgId),
        eq(chats.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (!chat) {
    throw new HttpError(404, "CHAT_NOT_FOUND", "Chat not found");
  }
  return {
    id: Number(chat.id),
    appId: Number(chat.appId),
  };
}

export async function insertChatMessageForScope(params: {
  context: RequestContext;
  chatId: number;
  role: "user" | "assistant";
  content: string;
}) {
  assertTenantScope(params.context);
  await initializeDatabase();

  const [inserted] = await db
    .insert(messages)
    .values({
      organizationId: params.context.orgId,
      workspaceId: params.context.workspaceId,
      createdByUserId: params.context.userId,
      chatId: params.chatId,
      role: params.role,
      content: params.content,
    })
    .returning();

  return mapMessageRow(inserted);
}
