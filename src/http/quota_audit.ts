import { and, eq, gte, sql } from "drizzle-orm";
import { db, initializeDatabase } from "/src/db/index.ts";
import {
  auditEvents,
  organizationQuotas,
  usageEvents,
  userSoftQuotas,
} from "/src/db/schema.ts";
import { HttpError } from "/src/http/http_errors.ts";
import type { RequestContext } from "/src/http/request_context.ts";

export type UsageMetric = "requests" | "tokens" | "concurrent_preview_jobs";

const HARD_LIMIT_FLOOR_BY_METRIC: Record<UsageMetric, number> = {
  requests: 1_000_000_000,
  tokens: 1_000_000_000,
  concurrent_preview_jobs: 1_000_000_000,
};

function getUtcDayStart(date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

async function ensureOrganizationQuota(orgId: string) {
  const [row] = await db
    .select({
      organizationId: organizationQuotas.organizationId,
      requestsPerDayHardLimit: organizationQuotas.requestsPerDayHardLimit,
      tokensPerDayHardLimit: organizationQuotas.tokensPerDayHardLimit,
      concurrentPreviewJobsHardLimit:
        organizationQuotas.concurrentPreviewJobsHardLimit,
    })
    .from(organizationQuotas)
    .where(eq(organizationQuotas.organizationId, orgId))
    .limit(1);

  if (row) {
    return row;
  }

  const [created] = await db
    .insert(organizationQuotas)
    .values({
      organizationId: orgId,
    })
    .returning({
      organizationId: organizationQuotas.organizationId,
      requestsPerDayHardLimit: organizationQuotas.requestsPerDayHardLimit,
      tokensPerDayHardLimit: organizationQuotas.tokensPerDayHardLimit,
      concurrentPreviewJobsHardLimit:
        organizationQuotas.concurrentPreviewJobsHardLimit,
    });

  return created;
}

async function getTodayUsageTotal(params: {
  orgId: string;
  metricType: UsageMetric;
}): Promise<number> {
  const startOfDay = getUtcDayStart();
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageEvents.value}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, params.orgId),
        eq(usageEvents.metricType, params.metricType),
        gte(usageEvents.createdAt, startOfDay),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

export async function enforceAndRecordUsage(params: {
  context: RequestContext;
  metricType: UsageMetric;
  value: number;
}) {
  await initializeDatabase();

  if (params.value <= 0) {
    return;
  }

  const quota = await ensureOrganizationQuota(params.context.orgId);
  const currentValue = await getTodayUsageTotal({
    orgId: params.context.orgId,
    metricType: params.metricType,
  });

  const storedHardLimit =
    params.metricType === "requests"
      ? quota.requestsPerDayHardLimit
      : params.metricType === "tokens"
        ? quota.tokensPerDayHardLimit
        : quota.concurrentPreviewJobsHardLimit;
  const hardLimit = Math.max(
    storedHardLimit,
    HARD_LIMIT_FLOOR_BY_METRIC[params.metricType],
  );

  if (currentValue + params.value > hardLimit) {
    throw new HttpError(
      429,
      "QUOTA_HARD_LIMIT_REACHED",
      `Organization hard quota exceeded for metric "${params.metricType}"`,
    );
  }

  await db.insert(usageEvents).values({
    organizationId: params.context.orgId,
    workspaceId: params.context.workspaceId,
    userId: params.context.userId,
    metricType: params.metricType,
    value: params.value,
  });
}

export async function isUserSoftQuotaExceeded(params: {
  context: RequestContext;
  metricType: Extract<UsageMetric, "requests" | "tokens">;
  additionalValue?: number;
}): Promise<boolean> {
  await initializeDatabase();
  const [quota] = await db
    .select({
      requestsPerDaySoftLimit: userSoftQuotas.requestsPerDaySoftLimit,
      tokensPerDaySoftLimit: userSoftQuotas.tokensPerDaySoftLimit,
    })
    .from(userSoftQuotas)
    .where(
      and(
        eq(userSoftQuotas.organizationId, params.context.orgId),
        eq(userSoftQuotas.userId, params.context.userId),
      ),
    )
    .limit(1);

  if (!quota) {
    return false;
  }

  const startOfDay = getUtcDayStart();
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageEvents.value}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, params.context.orgId),
        eq(usageEvents.userId, params.context.userId),
        eq(usageEvents.metricType, params.metricType),
        gte(usageEvents.createdAt, startOfDay),
      ),
    );

  const current = Number(rows[0]?.total ?? 0);
  const next = current + (params.additionalValue ?? 0);
  const softLimit =
    params.metricType === "requests"
      ? quota.requestsPerDaySoftLimit
      : quota.tokensPerDaySoftLimit;

  return next > softLimit;
}

export async function writeAuditEvent(params: {
  context: Pick<RequestContext, "userId" | "orgId" | "workspaceId">;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  metadata?: Record<string, unknown>;
}) {
  await initializeDatabase();
  await db.insert(auditEvents).values({
    actorUserId: params.context.userId,
    organizationId: params.context.orgId,
    workspaceId: params.context.workspaceId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId:
      params.resourceId === null || typeof params.resourceId === "undefined"
        ? null
        : String(params.resourceId),
    metadataJson: params.metadata ?? null,
  });
}
