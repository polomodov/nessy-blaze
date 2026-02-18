import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, initializeDatabase } from "../db";
import {
  apps,
  chats,
  language_model_providers,
  language_models,
  mcpServers,
  mcpToolConsents,
  membershipRoleEnum,
  messages,
  organizationMemberships,
  organizationQuotas,
  organizations,
  prompts,
  tenantMigrationMarkers,
  users,
  versions,
  workspaceMemberships,
  workspaces,
} from "../db/schema";
import { isDevBypassEnabled } from "./feature_flags";
import { HttpError } from "./http_errors";
import { validateAndDecodeJwt } from "./jwt_utils";

type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];

export interface RequestContext {
  userId: string;
  externalSub: string;
  email: string | null;
  displayName: string | null;
  orgId: string;
  workspaceId: string;
  organizationRole: MembershipRole;
  workspaceRole: MembershipRole;
  roles: MembershipRole[];
  authSource: "jwt" | "dev-bypass";
}

interface AuthIdentity {
  externalSub: string;
  email: string | null;
  displayName: string | null;
  source: "jwt" | "dev-bypass";
  devOrgHint?: string | null;
  devWorkspaceHint?: string | null;
}

const LEGACY_BACKFILL_MARKER = "multitenant_legacy_backfill_v1";

function readHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}

function getBearerToken(req: IncomingMessage): string | null {
  const authorization = readHeader(req, "authorization");
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return match[1]?.trim() || null;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "tenant";
}

function normalizeTenantIdentifier(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

async function resolveAuthIdentity(
  req: IncomingMessage,
): Promise<AuthIdentity> {
  const token = getBearerToken(req);
  if (token) {
    const claims = validateAndDecodeJwt(token);
    return {
      externalSub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      displayName: typeof claims.name === "string" ? claims.name : null,
      source: "jwt",
    };
  }

  if (!isDevBypassEnabled()) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "Missing Authorization Bearer token",
    );
  }

  const devSub = readHeader(req, "x-blaze-dev-user-sub") ?? "dev-user";
  const devEmail =
    readHeader(req, "x-blaze-dev-user-email") ?? "dev@local.blaze";
  const devName = readHeader(req, "x-blaze-dev-user-name") ?? "Dev User";
  const devOrgHint = readHeader(req, "x-blaze-dev-org-id");
  const devWorkspaceHint = readHeader(req, "x-blaze-dev-workspace-id");

  return {
    externalSub: devSub,
    email: devEmail,
    displayName: devName,
    source: "dev-bypass",
    devOrgHint,
    devWorkspaceHint,
  };
}

async function upsertUser(identity: AuthIdentity): Promise<{
  id: string;
  externalSub: string;
  email: string | null;
  displayName: string | null;
}> {
  const [user] = await db
    .insert(users)
    .values({
      externalSub: identity.externalSub,
      email: identity.email,
      displayName: identity.displayName,
    })
    .onConflictDoUpdate({
      target: users.externalSub,
      set: {
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: users.id,
      externalSub: users.externalSub,
      email: users.email,
      displayName: users.displayName,
    });

  return user;
}

async function createPersonalTenant(
  userId: string,
  identity: AuthIdentity,
): Promise<{
  orgId: string;
  orgRole: MembershipRole;
  workspaceId: string;
  workspaceRole: MembershipRole;
}> {
  const base = slugify(
    identity.email?.split("@")[0] ||
      identity.displayName ||
      identity.externalSub ||
      "personal",
  );
  const orgSlug = `${base}-${Date.now().toString(36)}`;
  const workspaceSlug = "personal";

  const created = await db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({
        slug: orgSlug,
        name: `${identity.displayName || identity.email || "Personal"} Organization`,
        createdByUserId: userId,
      })
      .returning({ id: organizations.id });

    await tx.insert(organizationMemberships).values({
      organizationId: organization.id,
      userId,
      role: "owner",
      status: "active",
    });

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        organizationId: organization.id,
        slug: workspaceSlug,
        name: "Personal Workspace",
        type: "personal",
        createdByUserId: userId,
      })
      .returning({ id: workspaces.id });

    await tx.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
    });

    await tx
      .insert(organizationQuotas)
      .values({
        organizationId: organization.id,
      })
      .onConflictDoNothing({
        target: organizationQuotas.organizationId,
      });

    return {
      orgId: organization.id,
      workspaceId: workspace.id,
    };
  });

  return {
    orgId: created.orgId,
    workspaceId: created.workspaceId,
    orgRole: "owner",
    workspaceRole: "owner",
  };
}

async function ensurePersonalWorkspaceInOrg(
  userId: string,
  organizationId: string,
): Promise<{ workspaceId: string; workspaceRole: MembershipRole }> {
  const currentMembership = await db
    .select({
      workspaceId: workspaces.id,
      workspaceRole: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        eq(workspaces.organizationId, organizationId),
      ),
    )
    .orderBy(asc(workspaceMemberships.createdAt))
    .limit(1);

  if (currentMembership.length > 0) {
    return {
      workspaceId: currentMembership[0].workspaceId,
      workspaceRole: currentMembership[0].workspaceRole,
    };
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({
      organizationId,
      slug: `personal-${randomUUID().slice(0, 8)}`,
      name: "Personal Workspace",
      type: "personal",
      createdByUserId: userId,
    })
    .returning({ id: workspaces.id });

  await db.insert(workspaceMemberships).values({
    workspaceId: workspace.id,
    userId,
    role: "owner",
  });

  return {
    workspaceId: workspace.id,
    workspaceRole: "owner",
  };
}

async function ensureDefaultTenant(
  userId: string,
  identity: AuthIdentity,
): Promise<{
  orgId: string;
  orgRole: MembershipRole;
  workspaceId: string;
  workspaceRole: MembershipRole;
}> {
  const membership = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
      ),
    )
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1);

  if (membership.length === 0) {
    return createPersonalTenant(userId, identity);
  }

  const current = membership[0];
  const workspace = await ensurePersonalWorkspaceInOrg(
    userId,
    current.organizationId,
  );
  return {
    orgId: current.organizationId,
    orgRole: current.role,
    workspaceId: workspace.workspaceId,
    workspaceRole: workspace.workspaceRole,
  };
}

async function resolveOrganizationForRequest(params: {
  userId: string;
  requestedOrgIdentifier: string | null;
  defaultOrgId: string;
}): Promise<{ orgId: string; orgRole: MembershipRole }> {
  const identifier = params.requestedOrgIdentifier;
  if (!identifier || identifier === "me") {
    const [defaultMembership] = await db
      .select({
        orgId: organizationMemberships.organizationId,
        orgRole: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, params.userId),
          eq(organizationMemberships.organizationId, params.defaultOrgId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);

    if (!defaultMembership) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "User is not active in requested organization",
      );
    }

    return {
      orgId: defaultMembership.orgId,
      orgRole: defaultMembership.orgRole,
    };
  }

  const [membership] = await db
    .select({
      orgId: organizations.id,
      orgRole: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizationMemberships.organizationId, organizations.id),
    )
    .where(
      and(
        eq(organizationMemberships.userId, params.userId),
        eq(organizationMemberships.status, "active"),
        or(
          eq(organizations.id, identifier),
          eq(organizations.slug, identifier),
        ),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "User is not active in requested organization",
    );
  }

  return {
    orgId: membership.orgId,
    orgRole: membership.orgRole,
  };
}

async function resolveWorkspaceForRequest(params: {
  userId: string;
  organizationId: string;
  requestedWorkspaceIdentifier: string | null;
  defaultWorkspaceId: string;
  organizationRole: MembershipRole;
}): Promise<{ workspaceId: string; workspaceRole: MembershipRole }> {
  const identifier = params.requestedWorkspaceIdentifier;
  if (!identifier || identifier === "me" || identifier === "personal") {
    const [workspaceMembership] = await db
      .select({
        workspaceId: workspaces.id,
        workspaceRole: workspaceMemberships.role,
      })
      .from(workspaceMemberships)
      .innerJoin(
        workspaces,
        eq(workspaceMemberships.workspaceId, workspaces.id),
      )
      .where(
        and(
          eq(workspaceMemberships.userId, params.userId),
          eq(workspaces.organizationId, params.organizationId),
          or(
            eq(workspaces.id, params.defaultWorkspaceId),
            eq(workspaces.slug, "personal"),
          ),
        ),
      )
      .orderBy(asc(workspaceMemberships.createdAt))
      .limit(1);

    if (!workspaceMembership) {
      const ensured = await ensurePersonalWorkspaceInOrg(
        params.userId,
        params.organizationId,
      );
      return {
        workspaceId: ensured.workspaceId,
        workspaceRole: ensured.workspaceRole,
      };
    }

    return {
      workspaceId: workspaceMembership.workspaceId,
      workspaceRole: workspaceMembership.workspaceRole,
    };
  }

  const [workspace] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceType: workspaces.type,
    })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.organizationId, params.organizationId),
        or(eq(workspaces.id, identifier), eq(workspaces.slug, identifier)),
      ),
    )
    .limit(1);

  if (!workspace) {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }

  const [workspaceMembership] = await db
    .select({
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspace.workspaceId),
        eq(workspaceMemberships.userId, params.userId),
      ),
    )
    .limit(1);

  if (workspaceMembership) {
    return {
      workspaceId: workspace.workspaceId,
      workspaceRole: workspaceMembership.role,
    };
  }

  if (
    (params.organizationRole === "owner" ||
      params.organizationRole === "admin") &&
    workspace.workspaceType === "team"
  ) {
    return {
      workspaceId: workspace.workspaceId,
      workspaceRole: params.organizationRole,
    };
  }

  throw new HttpError(
    403,
    "FORBIDDEN",
    "User is not active in requested workspace",
  );
}

async function maybeBackfillLegacyTenantData(ctx: {
  orgId: string;
  workspaceId: string;
  userId: string;
}) {
  const [marker] = await db
    .select({ key: tenantMigrationMarkers.key })
    .from(tenantMigrationMarkers)
    .where(eq(tenantMigrationMarkers.key, LEGACY_BACKFILL_MARKER))
    .limit(1);

  if (marker) {
    return;
  }

  await db.transaction(async (tx) => {
    const [markerInTx] = await tx
      .select({ key: tenantMigrationMarkers.key })
      .from(tenantMigrationMarkers)
      .where(eq(tenantMigrationMarkers.key, LEGACY_BACKFILL_MARKER))
      .limit(1);
    if (markerInTx) {
      return;
    }

    const tenantPatch = {
      organizationId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      createdByUserId: ctx.userId,
    };

    await tx
      .update(apps)
      .set(tenantPatch)
      .where(
        or(
          isNull(apps.organizationId),
          isNull(apps.workspaceId),
          isNull(apps.createdByUserId),
        ),
      );
    await tx
      .update(chats)
      .set(tenantPatch)
      .where(
        or(
          isNull(chats.organizationId),
          isNull(chats.workspaceId),
          isNull(chats.createdByUserId),
        ),
      );
    await tx
      .update(messages)
      .set(tenantPatch)
      .where(
        or(
          isNull(messages.organizationId),
          isNull(messages.workspaceId),
          isNull(messages.createdByUserId),
        ),
      );
    await tx
      .update(versions)
      .set(tenantPatch)
      .where(
        or(
          isNull(versions.organizationId),
          isNull(versions.workspaceId),
          isNull(versions.createdByUserId),
        ),
      );
    await tx
      .update(prompts)
      .set(tenantPatch)
      .where(
        or(
          isNull(prompts.organizationId),
          isNull(prompts.workspaceId),
          isNull(prompts.createdByUserId),
        ),
      );
    await tx
      .update(language_model_providers)
      .set(tenantPatch)
      .where(
        or(
          isNull(language_model_providers.organizationId),
          isNull(language_model_providers.workspaceId),
          isNull(language_model_providers.createdByUserId),
        ),
      );
    await tx
      .update(language_models)
      .set(tenantPatch)
      .where(
        or(
          isNull(language_models.organizationId),
          isNull(language_models.workspaceId),
          isNull(language_models.createdByUserId),
        ),
      );
    await tx
      .update(mcpServers)
      .set(tenantPatch)
      .where(
        or(
          isNull(mcpServers.organizationId),
          isNull(mcpServers.workspaceId),
          isNull(mcpServers.createdByUserId),
        ),
      );
    await tx
      .update(mcpToolConsents)
      .set(tenantPatch)
      .where(
        or(
          isNull(mcpToolConsents.organizationId),
          isNull(mcpToolConsents.workspaceId),
          isNull(mcpToolConsents.createdByUserId),
        ),
      );

    await tx.insert(tenantMigrationMarkers).values({
      key: LEGACY_BACKFILL_MARKER,
    });
  });
}

export async function resolveRequestContext(
  req: IncomingMessage,
  params?: {
    orgId?: string | null;
    workspaceId?: string | null;
  },
): Promise<RequestContext> {
  await initializeDatabase();

  const identity = await resolveAuthIdentity(req);
  const user = await upsertUser(identity);
  const defaults = await ensureDefaultTenant(user.id, identity);

  const requestedOrgIdentifier =
    normalizeTenantIdentifier(params?.orgId) ??
    normalizeTenantIdentifier(identity.devOrgHint);
  const requestedWorkspaceIdentifier =
    normalizeTenantIdentifier(params?.workspaceId) ??
    normalizeTenantIdentifier(identity.devWorkspaceHint);

  const orgResolution = await resolveOrganizationForRequest({
    userId: user.id,
    requestedOrgIdentifier,
    defaultOrgId: defaults.orgId,
  });

  const workspaceResolution = await resolveWorkspaceForRequest({
    userId: user.id,
    organizationId: orgResolution.orgId,
    requestedWorkspaceIdentifier,
    defaultWorkspaceId: defaults.workspaceId,
    organizationRole: orgResolution.orgRole,
  });

  await maybeBackfillLegacyTenantData({
    userId: user.id,
    orgId: orgResolution.orgId,
    workspaceId: workspaceResolution.workspaceId,
  });

  return {
    userId: user.id,
    externalSub: user.externalSub,
    email: user.email,
    displayName: user.displayName,
    orgId: orgResolution.orgId,
    workspaceId: workspaceResolution.workspaceId,
    organizationRole: orgResolution.orgRole,
    workspaceRole: workspaceResolution.workspaceRole,
    roles: Array.from(
      new Set([orgResolution.orgRole, workspaceResolution.workspaceRole]),
    ),
    authSource: identity.source,
  };
}

export function requireRoleForMutation(context: RequestContext): void {
  if (context.workspaceRole === "viewer") {
    throw new HttpError(403, "FORBIDDEN", "Viewer role is read-only");
  }
}
