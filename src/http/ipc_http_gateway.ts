import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { and, asc, desc, eq, gt, gte, ilike } from "drizzle-orm";
import git from "isomorphic-git";
import killPort from "kill-port";
import { initializeDatabase, db } from "/src/db/index.ts";
import {
  apps,
  chats,
  language_model_providers,
  messages,
  organizationMemberships,
  organizations,
  workspaceModelSettings,
  workspaceMemberships,
  workspaces,
} from "/src/db/schema.ts";
import { getBlazeAppPath, getUserDataPath } from "/src/paths/paths.ts";
import { getEnvVar } from "/src/ipc/utils/read_env.ts";
import { withLock } from "/src/ipc/utils/lock_utils.ts";
import { startProxy } from "/src/ipc/utils/start_proxy_server.ts";
import {
  processCounter,
  removeAppIfCurrentProcess,
  runningApps,
  stopAppByInfo,
} from "/src/ipc/utils/process_manager.ts";
import {
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  PROVIDER_TO_ENV_VAR,
} from "/src/ipc/shared/language_model_constants.ts";
import { UserSettingsSchema, type UserSettings } from "/src/lib/schemas.ts";
import { DEFAULT_TEMPLATE_ID } from "/src/shared/templates.ts";
import { DEFAULT_THEME_ID } from "/src/shared/themes.ts";
import { getAppPort } from "/shared/ports.ts";
import { isMultitenantEnforced } from "/src/http/feature_flags.ts";
import { HttpError } from "/src/http/http_errors.ts";
import { cleanUpPortWithVerification } from "/src/http/preview_port_cleanup.ts";
import {
  enforceAndRecordUsage,
  writeAuditEvent,
} from "/src/http/quota_audit.ts";
import type { RequestContext } from "/src/http/request_context.ts";
import { requireRoleForMutation } from "/src/http/request_context.ts";
import {
  createAppRecordForScope,
  createChatForScope,
  getAppByIdForScope,
  getChatForScope,
  getOrganizationByIdForUser,
  insertChatMessageForScope,
  listAppsForScope,
  listChatsForScope,
  listOrganizationsForUser,
  listWorkspacesForScope,
  searchAppsForScope,
  toggleAppFavoriteForScope,
} from "/src/http/scoped_repositories.ts";
import { processFullResponseActions } from "/src/ipc/processors/response_processor.ts";
import {
  getBlazeAddDependencyTags,
  getBlazeChatSummaryTag,
  getBlazeDeleteTags,
  getBlazeRenameTags,
  getBlazeSearchReplaceTags,
  getBlazeWriteTags,
} from "/src/ipc/utils/blaze_tag_parser.ts";
import { applyManualChangesWithSelfHealing } from "/src/ipc/utils/manual_apply_self_heal.ts";

interface InvokeMeta {
  requestContext?: RequestContext;
}

type InvokeHandler = (args: unknown[], meta?: InvokeMeta) => Promise<unknown>;

interface OAuth2TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface OAuth2ResolvedConfig {
  enabled: boolean;
  providerName: string;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  scope: string;
  redirectUri: string | null;
  extraAuthParams: Record<string, string>;
  extraTokenParams: Record<string, string>;
}

const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: randomUUID(),
  hasRunBefore: false,
  enableProLazyEditsMode: true,
  enableProSmartFilesContextMode: true,
  selectedChatMode: "build",
  autoApproveChanges: true,
  enableAutoFixProblems: false,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  uiLanguage: "ru",
  enableNativeGit: true,
});

function normalizeChatModeForHttpOnly(value: unknown): "build" | "ask" {
  return value === "ask" ? "ask" : "build";
}

function normalizeLegacyUserSettingsModes(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...settings };
  if ("selectedChatMode" in normalized) {
    normalized.selectedChatMode = normalizeChatModeForHttpOnly(
      normalized.selectedChatMode,
    );
  }
  if (
    "defaultChatMode" in normalized &&
    normalized.defaultChatMode !== undefined
  ) {
    normalized.defaultChatMode = normalizeChatModeForHttpOnly(
      normalized.defaultChatMode,
    );
  }
  return normalized;
}

function stripLegacyUserSettings(
  settings: Record<string, unknown>,
): UserSettings {
  return UserSettingsSchema.parse(normalizeLegacyUserSettingsModes(settings));
}

const UserSettingsPatchSchema = UserSettingsSchema.partial().strict();

function parseUserSettingsPatch(patch: unknown): Partial<UserSettings> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Invalid settings payload");
  }

  const parsedPatch = UserSettingsPatchSchema.safeParse(
    patch as Record<string, unknown>,
  );
  if (parsedPatch.success) {
    return parsedPatch.data;
  }

  const unsupportedKeys = parsedPatch.error.issues
    .filter((issue) => issue.code === "unrecognized_keys")
    .flatMap((issue) => (issue.code === "unrecognized_keys" ? issue.keys : []));

  if (unsupportedKeys.length > 0) {
    throw new Error(
      `Unsupported user settings keys: ${unsupportedKeys.join(", ")}`,
    );
  }

  throw new Error("Invalid settings payload");
}

function readRuntimeEnv(name: string): string | undefined {
  return process.env[name] ?? getEnvVar(name);
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = readRuntimeEnv(name);
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseOAuthExtraParams(
  value: string | undefined,
): Record<string, string> {
  if (!value) {
    return {};
  }

  const source = value.trim();
  if (!source) {
    return {};
  }

  const searchParams = new URLSearchParams(
    source.startsWith("?") ? source.slice(1) : source,
  );
  const result: Record<string, string> = {};

  for (const [key, rawValue] of searchParams.entries()) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    result[trimmedKey] = rawValue;
  }

  return result;
}

function toNullableTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveOAuth2Config(): OAuth2ResolvedConfig {
  const clientId = toNullableTrimmed(readRuntimeEnv("AUTH_OAUTH2_CLIENT_ID"));
  const clientSecret = toNullableTrimmed(
    readRuntimeEnv("AUTH_OAUTH2_CLIENT_SECRET"),
  );
  const authorizationUrl =
    toNullableTrimmed(readRuntimeEnv("AUTH_OAUTH2_AUTHORIZATION_URL")) ??
    "https://accounts.google.com/o/oauth2/v2/auth";
  const tokenUrl =
    toNullableTrimmed(readRuntimeEnv("AUTH_OAUTH2_TOKEN_URL")) ??
    "https://oauth2.googleapis.com/token";
  const redirectUri = toNullableTrimmed(
    readRuntimeEnv("AUTH_OAUTH2_REDIRECT_URI"),
  );
  const providerName =
    toNullableTrimmed(readRuntimeEnv("AUTH_OAUTH2_PROVIDER_NAME")) ?? "Google";
  const scope =
    toNullableTrimmed(readRuntimeEnv("AUTH_OAUTH2_SCOPE")) ??
    "openid profile email";
  const extraAuthParams = parseOAuthExtraParams(
    readRuntimeEnv("AUTH_OAUTH2_AUTH_EXTRA_PARAMS"),
  );
  const extraTokenParams = parseOAuthExtraParams(
    readRuntimeEnv("AUTH_OAUTH2_TOKEN_EXTRA_PARAMS"),
  );

  const enabledFromEnv = readBooleanEnv("AUTH_OAUTH2_ENABLED", true);
  const enabled =
    enabledFromEnv &&
    Boolean(clientId) &&
    Boolean(authorizationUrl) &&
    Boolean(tokenUrl);

  return {
    enabled,
    providerName,
    authorizationUrl,
    tokenUrl,
    clientId,
    clientSecret,
    scope,
    redirectUri,
    extraAuthParams,
    extraTokenParams,
  };
}

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

  const parsedNumber = Number(value);
  if (!Number.isNaN(parsedNumber)) {
    return new Date(parsedNumber * 1000).toISOString();
  }

  return null;
}

function sanitizePathName(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  if (sanitized) {
    return sanitized;
  }
  return "app";
}

async function stageAllFiles(dir: string): Promise<void> {
  const matrix = await git.statusMatrix({ fs, dir });

  for (const [filepath, headStatus, workdirStatus] of matrix) {
    if (headStatus === 0 && workdirStatus === 2) {
      await git.add({ fs, dir, filepath });
    }
  }
}

async function isGitWorkingTreeClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix.every(
    ([, headStatus, workdirStatus, stageStatus]) =>
      headStatus === 1 && workdirStatus === 1 && stageStatus === 1,
  );
}

async function stageWorkspaceToTargetCommit(
  dir: string,
  targetOid: string,
): Promise<void> {
  const currentCommit = await git.resolveRef({
    fs,
    dir,
    ref: "HEAD",
  });

  if (currentCommit === targetOid) {
    return;
  }

  if (!(await isGitWorkingTreeClean(dir))) {
    throw new Error("Cannot revert: working tree has uncommitted changes.");
  }

  const matrix = await git.statusMatrix({
    fs,
    dir,
    ref: targetOid,
  });

  for (const [filepath, headStatus, workdirStatus] of matrix) {
    const absoluteFilePath = path.join(dir, filepath);
    if (headStatus === 1) {
      if (workdirStatus === 1) {
        continue;
      }

      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: targetOid,
        filepath,
      });
      await fs.promises.mkdir(path.dirname(absoluteFilePath), {
        recursive: true,
      });
      await fs.promises.writeFile(absoluteFilePath, Buffer.from(blob));
      await git.add({ fs, dir, filepath });
      continue;
    }

    if (headStatus === 0 && workdirStatus !== 0) {
      await fs.promises.rm(absoluteFilePath, { force: true });
      try {
        await git.remove({
          fs,
          dir,
          filepath,
        });
      } catch {
        // Ignore files that are only present in the working tree.
      }
    }
  }
}

async function ensureWorkspaceForApp(
  appPath: string,
): Promise<{ initialCommitHash: string }> {
  const resolvedPath = getBlazeAppPath(appPath);
  const scaffoldPath = path.resolve(process.cwd(), "scaffold");

  if (!fs.existsSync(scaffoldPath)) {
    throw new Error(`Scaffold directory not found: ${scaffoldPath}`);
  }

  if (fs.existsSync(resolvedPath)) {
    throw new Error(`App already exists at: ${resolvedPath}`);
  }

  await fs.promises.mkdir(resolvedPath, { recursive: true });

  try {
    await fs.promises.cp(scaffoldPath, resolvedPath, { recursive: true });
    await git.init({ fs, dir: resolvedPath, defaultBranch: "main" });
    await stageAllFiles(resolvedPath);

    const initialCommitHash = await git.commit({
      fs,
      dir: resolvedPath,
      message: "Init Blaze app",
      author: {
        name: "Blaze",
        email: "noreply@blaze.sh",
      },
    });

    return { initialCommitHash };
  } catch (error) {
    await fs.promises.rm(resolvedPath, { recursive: true, force: true });
    throw error;
  }
}

function getSettingsFilePath(): string {
  return path.join(getUserDataPath(), "user-settings.json");
}

function readUserSettings(): UserSettings {
  const settingsPath = getSettingsFilePath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(DEFAULT_USER_SETTINGS, null, 2),
    );
    return stripLegacyUserSettings(DEFAULT_USER_SETTINGS);
  }

  try {
    const rawSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return stripLegacyUserSettings(
      UserSettingsSchema.parse({
        ...normalizeLegacyUserSettingsModes({
          ...DEFAULT_USER_SETTINGS,
          ...rawSettings,
        }),
      }),
    );
  } catch {
    return stripLegacyUserSettings(DEFAULT_USER_SETTINGS);
  }
}

function writeUserSettings(settings: Partial<UserSettings>): UserSettings {
  const mergedSettings = UserSettingsSchema.parse({
    ...readUserSettings(),
    ...settings,
  });
  fs.writeFileSync(
    getSettingsFilePath(),
    JSON.stringify(mergedSettings, null, 2),
  );
  return stripLegacyUserSettings(mergedSettings);
}

type AppRow = typeof apps.$inferSelect;
type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function mapAppRow(row: AppRow) {
  const appPath = String(row.path ?? "");
  return {
    id: Number(row.id),
    organizationId: row.organizationId ?? null,
    workspaceId: row.workspaceId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    name: String(row.name ?? ""),
    path: appPath,
    createdAt: toIsoDate(row.createdAt),
    updatedAt: toIsoDate(row.updatedAt),
    installCommand: row.installCommand ?? null,
    startCommand: row.startCommand ?? null,
    isFavorite: Boolean(row.isFavorite),
    resolvedPath: getBlazeAppPath(appPath),
  };
}

function mapChatRow(row: ChatRow) {
  return {
    id: Number(row.id),
    organizationId: row.organizationId ?? null,
    workspaceId: row.workspaceId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    appId: Number(row.appId),
    title: row.title ?? null,
    createdAt: toIsoDate(row.createdAt),
  };
}

function mapMessageRow(row: MessageRow) {
  return {
    id: Number(row.id),
    organizationId: row.organizationId ?? null,
    workspaceId: row.workspaceId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    chatId: Number(row.chatId),
    role: String(row.role),
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

function buildCodeProposalFromMessage(messageContent: string) {
  const proposalTitle = getBlazeChatSummaryTag(messageContent);
  const proposalWriteFiles = getBlazeWriteTags(messageContent);
  const proposalSearchReplaceFiles = getBlazeSearchReplaceTags(messageContent);
  const proposalRenameFiles = getBlazeRenameTags(messageContent);
  const proposalDeleteFiles = getBlazeDeleteTags(messageContent);
  const packagesAdded = getBlazeAddDependencyTags(messageContent);

  const filesChanged = [
    ...proposalWriteFiles.concat(proposalSearchReplaceFiles).map((tag) => ({
      name: path.basename(tag.path),
      path: tag.path,
      summary: tag.description ?? "(no change summary found)",
      type: "write" as const,
    })),
    ...proposalRenameFiles.map((tag) => ({
      name: path.basename(tag.to),
      path: tag.to,
      summary: `Rename from ${tag.from} to ${tag.to}`,
      type: "rename" as const,
    })),
    ...proposalDeleteFiles.map((tagPath) => ({
      name: path.basename(tagPath),
      path: tagPath,
      summary: "Delete file",
      type: "delete" as const,
    })),
  ];

  if (filesChanged.length === 0 && packagesAdded.length === 0) {
    return null;
  }

  return {
    type: "code-proposal" as const,
    title: proposalTitle ?? "Proposed File Changes",
    securityRisks: [],
    filesChanged,
    packagesAdded,
  };
}

function getRequestContext(meta?: InvokeMeta): RequestContext | null {
  return meta?.requestContext ?? null;
}

function requireScopedContext(meta?: InvokeMeta): RequestContext {
  const context = meta?.requestContext;
  if (!context) {
    throw new HttpError(
      400,
      "TENANT_SCOPE_REQUIRED",
      "Tenant scope is required for this operation",
    );
  }
  return context;
}

export type HttpChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

export async function doesHttpChatExist(
  chatId: number,
  context?: RequestContext,
): Promise<boolean> {
  await initializeDatabase();
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      context
        ? and(
            eq(chats.id, chatId),
            eq(chats.organizationId, context.orgId),
            eq(chats.workspaceId, context.workspaceId),
          )
        : eq(chats.id, chatId),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listHttpChatMessages(
  chatId: number,
  context?: RequestContext,
): Promise<HttpChatMessage[]> {
  await initializeDatabase();
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(
      context
        ? and(
            eq(messages.chatId, chatId),
            eq(messages.organizationId, context.orgId),
            eq(messages.workspaceId, context.workspaceId),
          )
        : eq(messages.chatId, chatId),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return rows.map((row) => ({
    id: Number(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content ?? ""),
  }));
}

export async function insertHttpChatMessage(params: {
  chatId: number;
  role: "user" | "assistant";
  content: string;
  context?: RequestContext;
}): Promise<HttpChatMessage> {
  const { chatId, role, content, context } = params;
  await initializeDatabase();

  const inserted = context
    ? await insertChatMessageForScope({
        context,
        chatId,
        role,
        content,
      })
    : await db
        .insert(messages)
        .values({ chatId, role, content })
        .returning({
          id: messages.id,
          role: messages.role,
          content: messages.content,
        })
        .then((rows) => rows[0]);

  return {
    id: Number(inserted.id),
    role: inserted.role === "assistant" ? "assistant" : "user",
    content: String(inserted.content ?? ""),
  };
}

async function listLanguageModelProviders(context?: RequestContext | null) {
  await initializeDatabase();
  const customProviders =
    context != null
      ? await db
          .select({
            id: language_model_providers.id,
            name: language_model_providers.name,
            api_base_url: language_model_providers.api_base_url,
            env_var_name: language_model_providers.env_var_name,
            trust_self_signed: language_model_providers.trust_self_signed,
          })
          .from(language_model_providers)
          .where(
            and(
              eq(language_model_providers.organizationId, context.orgId),
              eq(language_model_providers.workspaceId, context.workspaceId),
            ),
          )
      : await db
          .select({
            id: language_model_providers.id,
            name: language_model_providers.name,
            api_base_url: language_model_providers.api_base_url,
            env_var_name: language_model_providers.env_var_name,
            trust_self_signed: language_model_providers.trust_self_signed,
          })
          .from(language_model_providers);

  return [
    ...Object.entries(CLOUD_PROVIDERS).map(([providerId, provider]) => ({
      id: providerId,
      name: provider.displayName,
      hasFreeTier: provider.hasFreeTier,
      websiteUrl: provider.websiteUrl,
      gatewayPrefix: provider.gatewayPrefix,
      secondary: provider.secondary,
      envVarName: PROVIDER_TO_ENV_VAR[providerId],
      type: "cloud" as const,
    })),
    ...Object.entries(LOCAL_PROVIDERS).map(([providerId, provider]) => ({
      id: providerId,
      name: provider.displayName,
      hasFreeTier: provider.hasFreeTier,
      type: "local" as const,
    })),
    ...customProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      apiBaseUrl: provider.api_base_url,
      envVarName: provider.env_var_name ?? undefined,
      trustSelfSigned: Boolean(provider.trust_self_signed),
      type: "custom" as const,
    })),
  ];
}

function getDefaultCommand(appId: number): string {
  const port = getAppPort(appId);
  return `(pnpm install && pnpm run dev --port ${port}) || (npm install --legacy-peer-deps && npm run dev -- --port ${port})`;
}

function getRunCommand({
  appId,
  installCommand,
  startCommand,
}: {
  appId: number;
  installCommand?: string | null;
  startCommand?: string | null;
}): string {
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  return hasCustomCommands
    ? `${installCommand!.trim()} && ${startCommand!.trim()}`
    : getDefaultCommand(appId);
}

type PreviewProxyWorker = Awaited<ReturnType<typeof startProxy>>;

const previewProxyWorkers = new Map<number, PreviewProxyWorker>();
const previewProxyUrls = new Map<number, string>();

function getOriginalPreviewUrl(appId: number): string {
  return `http://127.0.0.1:${getAppPort(appId)}`;
}

async function stopPreviewProxyForApp(appId: number): Promise<void> {
  const worker = previewProxyWorkers.get(appId);
  previewProxyWorkers.delete(appId);
  previewProxyUrls.delete(appId);

  if (!worker) {
    return;
  }

  try {
    await worker.terminate();
  } catch {
    // ignore: worker may already be stopped
  }
}

function stopPreviewProxyForAppInBackground(appId: number): void {
  void stopPreviewProxyForApp(appId);
}

async function getOrCreatePreviewProxyUrl(appId: number): Promise<string> {
  const existingProxyUrl = previewProxyUrls.get(appId);
  if (existingProxyUrl) {
    return existingProxyUrl;
  }

  const originalUrl = getOriginalPreviewUrl(appId);
  let startedProxyUrl: string | null = null;
  let startupError: Error | null = null;

  const worker = await startProxy(originalUrl, {
    onStarted: (proxyUrl) => {
      startedProxyUrl = proxyUrl;
    },
  });

  worker.once("error", (error) => {
    startupError = new Error(
      `Failed to start preview proxy for app ${appId}: ${error.message}`,
    );
  });

  worker.once("exit", (code) => {
    if (!startedProxyUrl) {
      startupError = new Error(
        `Failed to start preview proxy for app ${appId}. Worker exited with code ${code}.`,
      );
    }
  });

  const timeoutMs = 10_000;
  const pollIntervalMs = 100;
  const startedAt = Date.now();
  while (startedProxyUrl == null && Date.now() - startedAt < timeoutMs) {
    if (startupError) {
      break;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  if (!startedProxyUrl) {
    try {
      await worker.terminate();
    } catch {
      // ignore termination errors on startup failure
    }
    throw (
      startupError ??
      new Error(`Timed out starting preview proxy for app ${appId}.`)
    );
  }

  previewProxyWorkers.set(appId, worker);
  previewProxyUrls.set(appId, startedProxyUrl);
  worker.once("exit", () => {
    const activeWorker = previewProxyWorkers.get(appId);
    if (activeWorker === worker) {
      previewProxyWorkers.delete(appId);
      previewProxyUrls.delete(appId);
    }
  });

  return startedProxyUrl;
}

function appendOutput(
  existing: string,
  chunk: string,
  maxLength = 6000,
): string {
  const combined = existing + chunk;
  if (combined.length <= maxLength) {
    return combined;
  }
  return combined.slice(combined.length - maxLength);
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });

    let resolved = false;
    const finalize = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(350);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
  });
}

async function waitForAppReady({
  appId,
  appPort,
  process,
  getRecentOutput,
}: {
  appId: number;
  appPort: number;
  process: ReturnType<typeof spawn>;
  getRecentOutput: () => string;
}): Promise<void> {
  const timeoutMs = 120_000;
  const pollIntervalMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (process.exitCode !== null || process.signalCode !== null) {
      const recentOutput = getRecentOutput().trim();
      throw new Error(
        `App ${appId} exited before preview became available. code=${process.exitCode}, signal=${process.signalCode}${
          recentOutput ? `\nRecent output:\n${recentOutput}` : ""
        }`,
      );
    }

    if (await isPortOpen(appPort)) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  const recentOutput = getRecentOutput().trim();
  throw new Error(
    `Timed out waiting for app ${appId} to listen on port ${appPort}.${
      recentOutput ? `\nRecent output:\n${recentOutput}` : ""
    }`,
  );
}

async function cleanUpPort(port: number): Promise<void> {
  await cleanUpPortWithVerification({
    port,
    isPortOpen,
    killPortFn: killPort,
  });
}

async function startPreviewAppForHttp(
  appId: number,
  context?: RequestContext | null,
): Promise<{ previewUrl: string; originalUrl: string }> {
  const app = await db.query.apps.findFirst({
    where:
      context != null
        ? and(
            eq(apps.id, appId),
            eq(apps.organizationId, context.orgId),
            eq(apps.workspaceId, context.workspaceId),
          )
        : eq(apps.id, appId),
  });
  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getBlazeAppPath(app.path);
  if (!fs.existsSync(appPath)) {
    throw new Error(`App directory does not exist: ${appPath}`);
  }

  const command = getRunCommand({
    appId,
    installCommand: app.installCommand,
    startCommand: app.startCommand,
  });

  const process = spawn(command, [], {
    cwd: appPath,
    shell: true,
    stdio: "pipe",
    detached: false,
  });

  if (!process.pid) {
    throw new Error(`Failed to spawn process for app ${appId}`);
  }

  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process,
    processId: currentProcessId,
    isDocker: false,
  });

  let recentOutput = "";
  process.stdout?.on("data", () => {
    // keep stream attached so process output pipe does not block
  });

  process.stdout?.on("data", (chunk) => {
    recentOutput = appendOutput(recentOutput, String(chunk));
  });

  process.stderr?.on("data", () => {
    // keep stream attached so process output pipe does not block
  });

  process.stderr?.on("data", (chunk) => {
    recentOutput = appendOutput(recentOutput, String(chunk));
  });

  process.on("close", () => {
    removeAppIfCurrentProcess(appId, process);
    stopPreviewProxyForAppInBackground(appId);
  });

  process.on("error", () => {
    removeAppIfCurrentProcess(appId, process);
    stopPreviewProxyForAppInBackground(appId);
  });

  const appPort = getAppPort(appId);
  try {
    await waitForAppReady({
      appId,
      appPort,
      process,
      getRecentOutput: () => recentOutput,
    });
    const originalUrl = getOriginalPreviewUrl(appId);
    const previewUrl = await getOrCreatePreviewProxyUrl(appId);
    return { previewUrl, originalUrl };
  } catch (error) {
    await stopPreviewProxyForApp(appId);
    const appInfo = runningApps.get(appId);
    if (appInfo) {
      await stopAppByInfo(appId, appInfo);
    }
    throw error;
  }
}

function hasConfiguredSecretValue(value: unknown): boolean {
  if (!value) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    const nestedValue = (value as Record<string, unknown>).value;
    return typeof nestedValue === "string" && nestedValue.trim().length > 0;
  }

  return true;
}

function maskProviderSettings(
  input: unknown,
): Record<string, { configured: boolean; keys: string[] }> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const output: Record<string, { configured: boolean; keys: string[] }> = {};
  for (const [provider, rawValue] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (!rawValue || typeof rawValue !== "object") {
      output[provider] = { configured: false, keys: [] };
      continue;
    }

    const configObj = rawValue as Record<string, unknown>;
    const keys = Object.keys(configObj);
    const configured = Object.values(configObj).some((value) =>
      hasConfiguredSecretValue(value),
    );
    output[provider] = { configured, keys };
  }

  return output;
}

const handlers: Record<string, InvokeHandler> = {
  async "get-user-settings"() {
    return readUserSettings();
  },

  async "set-user-settings"(args) {
    const [nextSettingsRaw] = args as [unknown];
    const nextSettings = parseUserSettingsPatch(nextSettingsRaw);
    return writeUserSettings(nextSettings);
  },

  async "get-oauth2-config"() {
    const config = resolveOAuth2Config();
    return {
      enabled: config.enabled,
      providerName: config.providerName,
      authorizationUrl: config.authorizationUrl,
      clientId: config.clientId,
      scope: config.scope,
      redirectUri: config.redirectUri,
      extraAuthParams: config.extraAuthParams,
    };
  },

  async "exchange-oauth2-code"(args) {
    const [payload] = args as [
      | { code?: string; codeVerifier?: string; redirectUri?: string }
      | undefined,
    ];
    const code = payload?.code?.trim();
    const codeVerifier = payload?.codeVerifier?.trim();
    if (!code) {
      throw new Error("Missing OAuth2 authorization code");
    }
    if (!codeVerifier) {
      throw new Error("Missing OAuth2 code verifier");
    }

    const config = resolveOAuth2Config();
    if (
      !config.enabled ||
      !config.clientId ||
      !config.tokenUrl ||
      !config.authorizationUrl
    ) {
      throw new Error("OAuth2 is not configured");
    }

    const redirectUri =
      payload?.redirectUri?.trim() ||
      config.redirectUri ||
      "http://localhost:5173/auth";

    const tokenRequestParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (config.clientSecret) {
      tokenRequestParams.set("client_secret", config.clientSecret);
    }
    for (const [key, value] of Object.entries(config.extraTokenParams)) {
      tokenRequestParams.set(key, value);
    }

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: tokenRequestParams.toString(),
    });

    const rawResponseText = await tokenResponse.text();
    let parsedResponse: OAuth2TokenResponse = {};
    if (rawResponseText.trim()) {
      try {
        parsedResponse = JSON.parse(rawResponseText) as OAuth2TokenResponse;
      } catch {
        throw new Error("OAuth2 token endpoint returned invalid JSON");
      }
    }

    if (!tokenResponse.ok) {
      const description =
        parsedResponse.error_description?.trim() ||
        parsedResponse.error?.trim() ||
        `OAuth2 token exchange failed with status ${tokenResponse.status}`;
      throw new Error(description);
    }

    return {
      accessToken: parsedResponse.access_token?.trim() || null,
      idToken: parsedResponse.id_token?.trim() || null,
      refreshToken: parsedResponse.refresh_token?.trim() || null,
      tokenType: parsedResponse.token_type?.trim() || null,
      expiresIn: parseNullableInt(parsedResponse.expires_in),
      scope: parsedResponse.scope?.trim() || null,
    };
  },

  async "list-orgs"(_args, meta) {
    const context = requireScopedContext(meta);
    return listOrganizationsForUser(context.userId);
  },

  async "create-org"(args, meta) {
    const context = requireScopedContext(meta);
    const [payload] = args as [{ name?: string; slug?: string } | undefined];
    const requestedName = payload?.name?.trim();
    const requestedSlug = payload?.slug?.trim();
    const nowSlugBase = requestedSlug
      ? sanitizePathName(requestedSlug)
      : `${sanitizePathName(context.displayName || "org")}-${Date.now().toString(36)}`;

    const [organization] = await db
      .insert(organizations)
      .values({
        name: requestedName || `${context.displayName || "My"} Organization`,
        slug: nowSlugBase,
        createdByUserId: context.userId,
      })
      .returning({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      });

    await db.insert(organizationMemberships).values({
      organizationId: organization.id,
      userId: context.userId,
      role: "owner",
      status: "active",
    });

    const [workspace] = await db
      .insert(workspaces)
      .values({
        organizationId: organization.id,
        slug: "personal",
        name: "Personal Workspace",
        type: "personal",
        createdByUserId: context.userId,
      })
      .returning({ id: workspaces.id });

    await db.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId: context.userId,
      role: "owner",
    });

    await writeAuditEvent({
      context: {
        userId: context.userId,
        orgId: organization.id,
        workspaceId: workspace.id,
      },
      action: "organization_create",
      resourceType: "organization",
      resourceId: organization.id,
      metadata: {
        slug: organization.slug,
      },
    });

    return {
      ...organization,
      role: "owner",
      status: "active",
      createdAt: toIsoDate(organization.createdAt),
      updatedAt: toIsoDate(organization.updatedAt),
    };
  },

  async "get-org"(_args, meta) {
    const context = requireScopedContext(meta);
    return getOrganizationByIdForUser({
      userId: context.userId,
      orgId: context.orgId,
    });
  },

  async "patch-org"(args, meta) {
    const context = requireScopedContext(meta);
    if (!["owner", "admin"].includes(context.organizationRole)) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only organization owner/admin can update organization settings",
      );
    }
    const [payload] = args as [{ name?: string } | undefined];
    const name = payload?.name?.trim();
    if (!name) {
      throw new HttpError(
        400,
        "INVALID_ORG_PAYLOAD",
        "Organization name is required",
      );
    }
    const [updated] = await db
      .update(organizations)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, context.orgId))
      .returning({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      });
    if (!updated) {
      throw new HttpError(404, "ORG_NOT_FOUND", "Organization not found");
    }

    await writeAuditEvent({
      context,
      action: "organization_update",
      resourceType: "organization",
      resourceId: context.orgId,
      metadata: { fields: ["name"] },
    });

    return {
      ...updated,
      role: context.organizationRole,
      status: "active",
      createdAt: toIsoDate(updated.createdAt),
      updatedAt: toIsoDate(updated.updatedAt),
    };
  },

  async "list-workspaces"(_args, meta) {
    const context = requireScopedContext(meta);
    return listWorkspacesForScope(context);
  },

  async "create-workspace"(args, meta) {
    const context = requireScopedContext(meta);
    if (!["owner", "admin"].includes(context.organizationRole)) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only organization owner/admin can create team workspaces",
      );
    }

    const [payload] = args as [
      { name?: string; slug?: string; type?: "personal" | "team" } | undefined,
    ];
    const name = payload?.name?.trim();
    if (!name) {
      throw new HttpError(
        400,
        "INVALID_WORKSPACE_PAYLOAD",
        "Workspace name is required",
      );
    }
    const slug = sanitizePathName(payload?.slug || name);
    const workspaceType = payload?.type === "personal" ? "personal" : "team";

    const [workspace] = await db
      .insert(workspaces)
      .values({
        organizationId: context.orgId,
        slug,
        name,
        type: workspaceType,
        createdByUserId: context.userId,
      })
      .returning({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
        slug: workspaces.slug,
        name: workspaces.name,
        type: workspaces.type,
        createdByUserId: workspaces.createdByUserId,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      });

    await db.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId: context.userId,
      role: "owner",
    });

    await writeAuditEvent({
      context: {
        userId: context.userId,
        orgId: context.orgId,
        workspaceId: workspace.id,
      },
      action: "workspace_create",
      resourceType: "workspace",
      resourceId: workspace.id,
      metadata: { type: workspace.type },
    });

    return {
      ...workspace,
      createdAt: toIsoDate(workspace.createdAt),
      updatedAt: toIsoDate(workspace.updatedAt),
    };
  },

  async "get-workspace"(_args, meta) {
    const context = requireScopedContext(meta);
    const [workspace] = await db
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
      .where(
        and(
          eq(workspaces.id, context.workspaceId),
          eq(workspaces.organizationId, context.orgId),
        ),
      )
      .limit(1);
    if (!workspace) {
      throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
    }
    return {
      ...workspace,
      createdAt: toIsoDate(workspace.createdAt),
      updatedAt: toIsoDate(workspace.updatedAt),
    };
  },

  async "patch-workspace"(args, meta) {
    const context = requireScopedContext(meta);
    if (
      !["owner", "admin"].includes(context.organizationRole) &&
      !["owner", "admin"].includes(context.workspaceRole)
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only owner/admin can update workspace settings",
      );
    }

    const [payload] = args as [{ name?: string; slug?: string } | undefined];
    const nextName = payload?.name?.trim();
    const nextSlug = payload?.slug?.trim()
      ? sanitizePathName(payload.slug)
      : undefined;
    if (!nextName && !nextSlug) {
      throw new HttpError(
        400,
        "INVALID_WORKSPACE_PAYLOAD",
        "At least one field (name, slug) is required",
      );
    }

    const [workspace] = await db
      .update(workspaces)
      .set({
        name: nextName,
        slug: nextSlug,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaces.id, context.workspaceId),
          eq(workspaces.organizationId, context.orgId),
        ),
      )
      .returning({
        id: workspaces.id,
        organizationId: workspaces.organizationId,
        slug: workspaces.slug,
        name: workspaces.name,
        type: workspaces.type,
        createdByUserId: workspaces.createdByUserId,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      });
    if (!workspace) {
      throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
    }

    await writeAuditEvent({
      context,
      action: "workspace_update",
      resourceType: "workspace",
      resourceId: context.workspaceId,
      metadata: { fields: Object.keys(payload ?? {}) },
    });

    return {
      ...workspace,
      createdAt: toIsoDate(workspace.createdAt),
      updatedAt: toIsoDate(workspace.updatedAt),
    };
  },

  async "delete-workspace"(_args, meta) {
    const context = requireScopedContext(meta);
    if (!["owner", "admin"].includes(context.organizationRole)) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only organization owner/admin can delete workspaces",
      );
    }

    const [workspace] = await db
      .select({
        id: workspaces.id,
        type: workspaces.type,
      })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, context.workspaceId),
          eq(workspaces.organizationId, context.orgId),
        ),
      )
      .limit(1);
    if (!workspace) {
      throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
    }
    if (workspace.type === "personal") {
      throw new HttpError(
        400,
        "INVALID_WORKSPACE_DELETE",
        "Personal workspace cannot be deleted",
      );
    }

    await db.delete(workspaces).where(eq(workspaces.id, context.workspaceId));

    await writeAuditEvent({
      context,
      action: "workspace_delete",
      resourceType: "workspace",
      resourceId: context.workspaceId,
    });
    return;
  },

  async "get-app-version"() {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return { version: packageJson.version };
  },

  async "list-apps"(_args, meta) {
    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      return {
        apps: await listAppsForScope(scopedContext),
      };
    }
    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "list-apps requires tenant scope in enforce mode",
      );
    }

    const rows = await db.select().from(apps).orderBy(desc(apps.createdAt));
    return {
      apps: rows.map(mapAppRow),
    };
  },

  async "read-app-file"(args, meta) {
    const [params] = args as [
      { appId?: number; filePath?: string } | undefined,
    ];
    const appId = params?.appId;
    const filePath = params?.filePath;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("Invalid file path");
    }

    const scopedContext = getRequestContext(meta);
    let appPath: string;
    if (scopedContext) {
      const app = await getAppByIdForScope(scopedContext, appId);
      appPath = getBlazeAppPath(app.path);
    } else {
      if (isMultitenantEnforced()) {
        throw new HttpError(
          400,
          "TENANT_SCOPE_REQUIRED",
          "read-app-file requires tenant scope in enforce mode",
        );
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: { path: true },
      });
      if (!app) {
        throw new Error("App not found");
      }
      appPath = getBlazeAppPath(app.path);
    }

    const resolvedAppPath = path.resolve(appPath);
    const resolvedFilePath = path.resolve(resolvedAppPath, filePath);
    const isInsideAppPath =
      resolvedFilePath === resolvedAppPath ||
      resolvedFilePath.startsWith(`${resolvedAppPath}${path.sep}`);

    if (!isInsideAppPath) {
      throw new Error("Invalid file path");
    }
    if (!fs.existsSync(resolvedFilePath)) {
      throw new Error("File not found");
    }

    return fs.readFileSync(resolvedFilePath, "utf-8");
  },

  async "search-app"(args, meta) {
    const [searchQuery] = args as [string];
    if (typeof searchQuery !== "string") {
      throw new Error("Invalid search query");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      return searchAppsForScope(scopedContext, searchQuery);
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "search-app requires tenant scope in enforce mode",
      );
    }

    const rows = await db
      .select({ id: apps.id, name: apps.name, createdAt: apps.createdAt })
      .from(apps)
      .where(ilike(apps.name, `%${searchQuery}%`))
      .orderBy(desc(apps.createdAt));

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      createdAt: toIsoDate(row.createdAt),
      matchedChatTitle: null,
      matchedChatMessage: null,
    }));
  },

  async "get-app"(args, meta) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      return getAppByIdForScope(scopedContext, appId);
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "get-app requires tenant scope in enforce mode",
      );
    }

    const row = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!row) {
      throw new Error("App not found");
    }

    return mapAppRow(row);
  },

  async "patch-app"(args, meta) {
    const context = requireScopedContext(meta);
    requireRoleForMutation(context);
    const [appId, payload] = args as [
      number,
      { name?: string; isFavorite?: boolean } | undefined,
    ];
    if (typeof appId !== "number") {
      throw new HttpError(400, "INVALID_APP_ID", "Invalid app ID");
    }
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (typeof payload?.name === "string") {
      updates.name = payload.name.trim();
    }
    if (typeof payload?.isFavorite === "boolean") {
      updates.isFavorite = payload.isFavorite;
    }
    const [updated] = await db
      .update(apps)
      .set(updates)
      .where(
        and(
          eq(apps.id, appId),
          eq(apps.organizationId, context.orgId),
          eq(apps.workspaceId, context.workspaceId),
        ),
      )
      .returning();
    if (!updated) {
      throw new HttpError(404, "APP_NOT_FOUND", "App not found");
    }

    await writeAuditEvent({
      context,
      action: "app_update",
      resourceType: "app",
      resourceId: appId,
      metadata: { fields: Object.keys(payload ?? {}) },
    });

    return mapAppRow(updated);
  },

  async "delete-app"(args, meta) {
    const context = requireScopedContext(meta);
    requireRoleForMutation(context);
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new HttpError(400, "INVALID_APP_ID", "Invalid app ID");
    }
    const [deleted] = await db
      .delete(apps)
      .where(
        and(
          eq(apps.id, appId),
          eq(apps.organizationId, context.orgId),
          eq(apps.workspaceId, context.workspaceId),
        ),
      )
      .returning({ id: apps.id });
    if (!deleted) {
      throw new HttpError(404, "APP_NOT_FOUND", "App not found");
    }
    await writeAuditEvent({
      context,
      action: "app_delete",
      resourceType: "app",
      resourceId: appId,
    });
    return;
  },

  async "create-app"(args, meta) {
    const [params] = args as [{ name?: string }];
    const appName = params?.name?.trim();

    if (!appName) {
      throw new Error("App name is required");
    }

    const appPath = `${sanitizePathName(appName)}-${Date.now()}`;
    const { initialCommitHash } = await ensureWorkspaceForApp(appPath);

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      requireRoleForMutation(scopedContext);
      await enforceAndRecordUsage({
        context: scopedContext,
        metricType: "requests",
        value: 1,
      });
      const result = await createAppRecordForScope({
        context: scopedContext,
        name: appName,
        path: appPath,
        initialCommitHash,
      });
      await writeAuditEvent({
        context: scopedContext,
        action: "app_create",
        resourceType: "app",
        resourceId: result.app.id,
      });
      return {
        app: {
          ...result.app,
          resolvedPath: getBlazeAppPath(result.app.path),
        },
        chatId: result.chatId,
      };
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "create-app requires tenant scope in enforce mode",
      );
    }

    const { appRow, chatId } = await db.transaction(async (tx) => {
      const [createdApp] = await tx
        .insert(apps)
        .values({
          name: appName,
          path: appPath,
          isFavorite: false,
        })
        .returning();

      const [createdChat] = await tx
        .insert(chats)
        .values({
          appId: createdApp.id,
          title: null,
          initialCommitHash,
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
  },

  async "add-to-favorite"(args, meta) {
    const [params] = args as [{ appId?: number }];
    const appId = params?.appId;

    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      requireRoleForMutation(scopedContext);
      return toggleAppFavoriteForScope(scopedContext, appId);
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "add-to-favorite requires tenant scope in enforce mode",
      );
    }

    const currentRow = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
      columns: {
        id: true,
        isFavorite: true,
      },
    });

    if (!currentRow) {
      throw new Error("App not found");
    }

    const nextFavoriteState = !currentRow.isFavorite;
    await db
      .update(apps)
      .set({
        isFavorite: nextFavoriteState,
        updatedAt: new Date(),
      })
      .where(eq(apps.id, appId));

    return { isFavorite: nextFavoriteState };
  },

  async "get-chats"(args, meta) {
    const [appId] = args as [number | undefined];
    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      return listChatsForScope(scopedContext, appId);
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "get-chats requires tenant scope in enforce mode",
      );
    }

    const rows =
      typeof appId === "number"
        ? await db
            .select()
            .from(chats)
            .where(eq(chats.appId, appId))
            .orderBy(desc(chats.createdAt))
        : await db.select().from(chats).orderBy(desc(chats.createdAt));

    return rows.map(mapChatRow);
  },

  async "create-chat"(args, meta) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      requireRoleForMutation(scopedContext);
      await enforceAndRecordUsage({
        context: scopedContext,
        metricType: "requests",
        value: 1,
      });
      const chatId = await createChatForScope(scopedContext, appId);
      await writeAuditEvent({
        context: scopedContext,
        action: "chat_create",
        resourceType: "chat",
        resourceId: chatId,
      });
      return chatId;
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "create-chat requires tenant scope in enforce mode",
      );
    }

    const appExists = await db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);

    if (appExists.length === 0) {
      throw new Error("App not found");
    }

    const [inserted] = await db
      .insert(chats)
      .values({
        appId,
        title: null,
        initialCommitHash: null,
      })
      .returning({ id: chats.id });

    return Number(inserted.id);
  },

  async "get-chat"(args, meta) {
    const [chatId] = args as [number];
    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      return getChatForScope(scopedContext, chatId);
    }

    if (isMultitenantEnforced()) {
      throw new HttpError(
        400,
        "TENANT_SCOPE_REQUIRED",
        "get-chat requires tenant scope in enforce mode",
      );
    }

    const chatRow = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: {
        id: true,
        appId: true,
        title: true,
        initialCommitHash: true,
        createdAt: true,
      },
    });

    if (!chatRow) {
      throw new Error("Chat not found");
    }

    const messageRows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt), asc(messages.id));

    return {
      id: Number(chatRow.id),
      appId: Number(chatRow.appId),
      title: chatRow.title ?? null,
      initialCommitHash: chatRow.initialCommitHash ?? null,
      createdAt: toIsoDate(chatRow.createdAt),
      messages: messageRows.map(mapMessageRow),
    };
  },

  async "list-versions"(args, meta) {
    const [payload] = args as [{ appId?: number } | undefined];
    const appId = payload?.appId;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    let appPath: string;
    if (scopedContext) {
      const app = await getAppByIdForScope(scopedContext, appId);
      appPath = getBlazeAppPath(app.path);
    } else {
      if (isMultitenantEnforced()) {
        throw new HttpError(
          400,
          "TENANT_SCOPE_REQUIRED",
          "list-versions requires tenant scope in enforce mode",
        );
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: {
          path: true,
        },
      });
      if (!app?.path) {
        return [];
      }
      appPath = getBlazeAppPath(app.path);
    }

    if (!fs.existsSync(path.join(appPath, ".git"))) {
      return [];
    }

    const commits = await git.log({
      fs,
      dir: appPath,
      depth: 100_000,
    });

    return commits.map((commit) => ({
      oid: commit.oid,
      message: commit.commit.message,
      timestamp: commit.commit.author.timestamp,
    }));
  },

  async "checkout-version"(args, meta) {
    const [payload] = args as [
      | {
          appId?: number;
          versionId?: string;
        }
      | undefined,
    ];
    const appId = payload?.appId;
    const versionId = payload?.versionId;

    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }
    if (typeof versionId !== "string" || versionId.length === 0) {
      throw new Error("Invalid version ID");
    }

    return withLock(appId, async () => {
      const scopedContext = getRequestContext(meta);
      let appPath: string;
      if (scopedContext) {
        requireRoleForMutation(scopedContext);
        const app = await getAppByIdForScope(scopedContext, appId);
        appPath = getBlazeAppPath(app.path);
      } else {
        if (isMultitenantEnforced()) {
          throw new HttpError(
            400,
            "TENANT_SCOPE_REQUIRED",
            "checkout-version requires tenant scope in enforce mode",
          );
        }

        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
          columns: {
            path: true,
          },
        });
        if (!app?.path) {
          throw new Error("App not found");
        }
        appPath = getBlazeAppPath(app.path);
      }

      if (!fs.existsSync(path.join(appPath, ".git"))) {
        throw new Error("Not a git repository");
      }

      await git.checkout({
        fs,
        dir: appPath,
        ref: versionId,
      });
    });
  },

  async "get-current-branch"(args, meta) {
    const [payload] = args as [{ appId?: number } | undefined];
    const appId = payload?.appId;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    let appPath: string;
    if (scopedContext) {
      const app = await getAppByIdForScope(scopedContext, appId);
      appPath = getBlazeAppPath(app.path);
    } else {
      if (isMultitenantEnforced()) {
        throw new HttpError(
          400,
          "TENANT_SCOPE_REQUIRED",
          "get-current-branch requires tenant scope in enforce mode",
        );
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: {
          path: true,
        },
      });
      if (!app?.path) {
        throw new Error("App not found");
      }
      appPath = getBlazeAppPath(app.path);
    }

    if (!fs.existsSync(path.join(appPath, ".git"))) {
      throw new Error("Not a git repository");
    }

    const branch = await git.currentBranch({
      fs,
      dir: appPath,
      fullname: false,
    });

    return {
      branch: branch ?? "<no-branch>",
    };
  },

  async "revert-version"(args, meta) {
    const [payload] = args as [
      | {
          appId?: number;
          previousVersionId?: string;
          currentChatMessageId?: {
            chatId?: number;
            messageId?: number;
          };
        }
      | undefined,
    ];
    const appId = payload?.appId;
    const previousVersionId = payload?.previousVersionId;
    const currentChatMessageId = payload?.currentChatMessageId;

    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }
    if (
      typeof previousVersionId !== "string" ||
      previousVersionId.length === 0
    ) {
      throw new Error("Invalid version ID");
    }

    return withLock(appId, async () => {
      const scopedContext = getRequestContext(meta);
      let appPath: string;
      if (scopedContext) {
        requireRoleForMutation(scopedContext);
        const app = await getAppByIdForScope(scopedContext, appId);
        appPath = getBlazeAppPath(app.path);
      } else {
        if (isMultitenantEnforced()) {
          throw new HttpError(
            400,
            "TENANT_SCOPE_REQUIRED",
            "revert-version requires tenant scope in enforce mode",
          );
        }

        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
          columns: {
            path: true,
          },
        });
        if (!app?.path) {
          throw new Error("App not found");
        }
        appPath = getBlazeAppPath(app.path);
      }

      await git.checkout({ fs, dir: appPath, ref: "main" });
      await stageWorkspaceToTargetCommit(appPath, previousVersionId);

      const hasNoChangesToCommit = await isGitWorkingTreeClean(appPath);
      if (!hasNoChangesToCommit) {
        await git.commit({
          fs,
          dir: appPath,
          message: `Reverted all changes back to version ${previousVersionId}`,
          author: {
            name: "Blaze",
            email: "noreply@blaze.sh",
          },
        });
      }

      if (currentChatMessageId) {
        if (
          typeof currentChatMessageId.chatId !== "number" ||
          typeof currentChatMessageId.messageId !== "number"
        ) {
          throw new Error("Invalid current chat message ID");
        }

        const whereConditions = [
          eq(messages.chatId, currentChatMessageId.chatId),
          gte(messages.id, currentChatMessageId.messageId),
        ];
        if (scopedContext) {
          await getChatForScope(scopedContext, currentChatMessageId.chatId);
          whereConditions.push(
            eq(messages.organizationId, scopedContext.orgId),
            eq(messages.workspaceId, scopedContext.workspaceId),
          );
        }

        await db.delete(messages).where(and(...whereConditions));
      } else {
        const messageLookupWhere = [eq(messages.commitHash, previousVersionId)];
        if (scopedContext) {
          messageLookupWhere.push(
            eq(messages.organizationId, scopedContext.orgId),
            eq(messages.workspaceId, scopedContext.workspaceId),
          );
        }

        const messageWithCommit = await db.query.messages.findFirst({
          where: and(...messageLookupWhere),
          columns: {
            id: true,
            chatId: true,
          },
        });

        if (messageWithCommit) {
          const deleteWhereConditions = [
            eq(messages.chatId, messageWithCommit.chatId),
            gt(messages.id, messageWithCommit.id),
          ];
          if (scopedContext) {
            deleteWhereConditions.push(
              eq(messages.organizationId, scopedContext.orgId),
              eq(messages.workspaceId, scopedContext.workspaceId),
            );
          }

          await db.delete(messages).where(and(...deleteWhereConditions));
        }
      }

      if (hasNoChangesToCommit) {
        return {
          warningMessage: "No changes were needed for rollback.",
        };
      }

      return {
        successMessage: "Restored version",
      };
    });
  },

  async "get-proposal"(args, meta) {
    const [payload] = args as [{ chatId?: number } | undefined];
    const chatId = payload?.chatId;
    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
    }

    return withLock(`get-proposal:${chatId}`, async () => {
      const scopedContext = getRequestContext(meta);
      let latestAssistantMessage:
        | {
            id: number;
            content: string;
            approvalState: "approved" | "rejected" | null;
          }
        | undefined;

      if (scopedContext) {
        const chat = await getChatForScope(scopedContext, chatId);
        latestAssistantMessage = [...chat.messages]
          .reverse()
          .find((message) => message.role === "assistant");
      } else {
        if (isMultitenantEnforced()) {
          throw new HttpError(
            400,
            "TENANT_SCOPE_REQUIRED",
            "get-proposal requires tenant scope in enforce mode",
          );
        }

        latestAssistantMessage = await db.query.messages.findFirst({
          where: and(
            eq(messages.chatId, chatId),
            eq(messages.role, "assistant"),
          ),
          orderBy: [desc(messages.createdAt), desc(messages.id)],
          columns: {
            id: true,
            content: true,
            approvalState: true,
          },
        });
      }

      if (
        !latestAssistantMessage?.content ||
        latestAssistantMessage.approvalState
      ) {
        return null;
      }

      const proposal = buildCodeProposalFromMessage(
        latestAssistantMessage.content,
      );
      if (!proposal) {
        return null;
      }

      return {
        proposal,
        chatId,
        messageId: latestAssistantMessage.id,
      };
    });
  },

  async "approve-proposal"(args, meta) {
    const [payload] = args as [{ chatId?: number; messageId?: number }];
    const chatId = payload?.chatId;
    const messageId = payload?.messageId;

    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
    }
    if (typeof messageId !== "number") {
      throw new Error("Invalid message ID");
    }

    const settings = readUserSettings();
    if (settings.selectedChatMode === "ask") {
      throw new Error(
        "Ask mode is not supported for proposal approval. Please switch to build mode.",
      );
    }

    return withLock(`approve-proposal:${chatId}:${messageId}`, async () => {
      const scopedContext = getRequestContext(meta);
      const whereConditions = [
        eq(messages.id, messageId),
        eq(messages.chatId, chatId),
        eq(messages.role, "assistant"),
      ];

      if (scopedContext) {
        requireRoleForMutation(scopedContext);
        await getChatForScope(scopedContext, chatId);
        whereConditions.push(
          eq(messages.organizationId, scopedContext.orgId),
          eq(messages.workspaceId, scopedContext.workspaceId),
        );
      } else if (isMultitenantEnforced()) {
        throw new HttpError(
          400,
          "TENANT_SCOPE_REQUIRED",
          "approve-proposal requires tenant scope in enforce mode",
        );
      }

      const messageToApprove = await db.query.messages.findFirst({
        where: and(...whereConditions),
        columns: {
          content: true,
        },
      });

      if (!messageToApprove?.content) {
        throw new Error(
          `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`,
        );
      }

      const chatSummary = getBlazeChatSummaryTag(messageToApprove.content);
      const selfHealingResult = await applyManualChangesWithSelfHealing({
        rawResponse: messageToApprove.content,
        applyResponse: async (responsePayload) =>
          processFullResponseActions(responsePayload, chatId, {
            chatSummary: chatSummary ?? undefined,
            messageId,
          }),
      });

      const processResult = selfHealingResult.processResult;
      if (processResult.error) {
        const selfHealErrors = selfHealingResult.attempts
          .map((attempt) => attempt.error)
          .filter((value): value is string => Boolean(value));
        const selfHealSuffix =
          selfHealErrors.length > 0
            ? ` (self-healing attempts: ${selfHealErrors.join(" | ")})`
            : "";
        throw new Error(
          `Error processing actions for message ${messageId}: ${processResult.error}${selfHealSuffix}`,
        );
      }

      const selfHealErrors = selfHealingResult.attempts
        .map((attempt) => attempt.error)
        .filter((value): value is string => Boolean(value));

      return {
        updatedFiles: processResult.updatedFiles,
        extraFiles: processResult.extraFiles,
        extraFilesError: processResult.extraFilesError,
        selfHealAttempted: selfHealingResult.attempts.length > 1,
        selfHealRecovered: selfHealingResult.recoveredBySelfHealing,
        selfHealAttempts: selfHealingResult.attempts.length,
        selfHealErrors: selfHealErrors.length > 0 ? selfHealErrors : undefined,
      };
    });
  },

  async "reject-proposal"(args, meta) {
    const [payload] = args as [{ chatId?: number; messageId?: number }];
    const chatId = payload?.chatId;
    const messageId = payload?.messageId;

    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
    }
    if (typeof messageId !== "number") {
      throw new Error("Invalid message ID");
    }

    return withLock(`reject-proposal:${chatId}:${messageId}`, async () => {
      const scopedContext = getRequestContext(meta);
      const whereConditions = [
        eq(messages.id, messageId),
        eq(messages.chatId, chatId),
        eq(messages.role, "assistant"),
      ];

      if (scopedContext) {
        requireRoleForMutation(scopedContext);
        await getChatForScope(scopedContext, chatId);
        whereConditions.push(
          eq(messages.organizationId, scopedContext.orgId),
          eq(messages.workspaceId, scopedContext.workspaceId),
        );
      } else if (isMultitenantEnforced()) {
        throw new HttpError(
          400,
          "TENANT_SCOPE_REQUIRED",
          "reject-proposal requires tenant scope in enforce mode",
        );
      }

      const messageToReject = await db.query.messages.findFirst({
        where: and(...whereConditions),
        columns: {
          id: true,
        },
      });

      if (!messageToReject) {
        throw new Error(
          `Assistant message not found for chatId: ${chatId}, messageId: ${messageId}`,
        );
      }

      await db
        .update(messages)
        .set({ approvalState: "rejected" })
        .where(eq(messages.id, messageId));
      return;
    });
  },

  async "update-chat"(args, meta) {
    const context = requireScopedContext(meta);
    requireRoleForMutation(context);
    const [payload] = args as [{ chatId?: number; title?: string }];
    const chatId = payload?.chatId;
    if (typeof chatId !== "number") {
      throw new HttpError(400, "INVALID_CHAT_ID", "Invalid chat ID");
    }

    const [updated] = await db
      .update(chats)
      .set({
        title: payload?.title?.trim() || null,
      })
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.organizationId, context.orgId),
          eq(chats.workspaceId, context.workspaceId),
        ),
      )
      .returning({ id: chats.id, title: chats.title });
    if (!updated) {
      throw new HttpError(404, "CHAT_NOT_FOUND", "Chat not found");
    }

    await writeAuditEvent({
      context,
      action: "chat_update",
      resourceType: "chat",
      resourceId: chatId,
      metadata: { fields: ["title"] },
    });

    return {
      id: Number(updated.id),
      title: updated.title,
    };
  },

  async "delete-chat"(args, meta) {
    const context = requireScopedContext(meta);
    requireRoleForMutation(context);
    const [chatId] = args as [number];
    if (typeof chatId !== "number") {
      throw new HttpError(400, "INVALID_CHAT_ID", "Invalid chat ID");
    }

    const [deleted] = await db
      .delete(chats)
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.organizationId, context.orgId),
          eq(chats.workspaceId, context.workspaceId),
        ),
      )
      .returning({ id: chats.id });
    if (!deleted) {
      throw new HttpError(404, "CHAT_NOT_FOUND", "Chat not found");
    }

    await writeAuditEvent({
      context,
      action: "chat_delete",
      resourceType: "chat",
      resourceId: chatId,
    });
    return;
  },

  async "get-workspace-model-settings"(_args, meta) {
    const context = requireScopedContext(meta);
    const [row] = await db
      .select({
        selectedModelJson: workspaceModelSettings.selectedModelJson,
        providerSettingsJson: workspaceModelSettings.providerSettingsJson,
        updatedAt: workspaceModelSettings.updatedAt,
      })
      .from(workspaceModelSettings)
      .where(
        and(
          eq(workspaceModelSettings.organizationId, context.orgId),
          eq(workspaceModelSettings.workspaceId, context.workspaceId),
        ),
      )
      .limit(1);

    return {
      selectedModel: row?.selectedModelJson ?? null,
      providerSettings: maskProviderSettings(row?.providerSettingsJson ?? null),
      updatedAt: toIsoDate(row?.updatedAt),
    };
  },

  async "set-workspace-model-settings"(args, meta) {
    const context = requireScopedContext(meta);
    requireRoleForMutation(context);
    const [payload] = args as [
      | {
          selectedModel?: Record<string, unknown>;
          providerSettings?: Record<string, unknown>;
        }
      | undefined,
    ];

    const [row] = await db
      .insert(workspaceModelSettings)
      .values({
        organizationId: context.orgId,
        workspaceId: context.workspaceId,
        selectedModelJson: payload?.selectedModel ?? null,
        providerSettingsJson: payload?.providerSettings ?? null,
        updatedByUserId: context.userId,
      })
      .onConflictDoUpdate({
        target: workspaceModelSettings.workspaceId,
        set: {
          selectedModelJson: payload?.selectedModel ?? null,
          providerSettingsJson: payload?.providerSettings ?? null,
          updatedByUserId: context.userId,
          updatedAt: new Date(),
        },
      })
      .returning({
        selectedModelJson: workspaceModelSettings.selectedModelJson,
        providerSettingsJson: workspaceModelSettings.providerSettingsJson,
        updatedAt: workspaceModelSettings.updatedAt,
      });

    await writeAuditEvent({
      context,
      action: "workspace_model_settings_update",
      resourceType: "workspace_model_settings",
      metadata: {
        selectedModelSet: Boolean(payload?.selectedModel),
        providerSettingsKeys: Object.keys(payload?.providerSettings ?? {}),
      },
    });

    return {
      selectedModel: row.selectedModelJson ?? null,
      providerSettings: maskProviderSettings(row.providerSettingsJson ?? null),
      updatedAt: toIsoDate(row.updatedAt),
    };
  },

  async "get-workspace-env-providers"(_args, meta) {
    const context = requireScopedContext(meta);
    const providers = await listLanguageModelProviders(context);
    return providers.map((provider) => {
      const envVarName =
        "envVarName" in provider ? provider.envVarName : undefined;
      return {
        id: provider.id,
        name: provider.name,
        envVarName: envVarName ?? null,
        configured: Boolean(envVarName && getEnvVar(envVarName)),
        type: provider.type,
      };
    });
  },

  async "get-env-vars"(_args, meta) {
    const providers = await listLanguageModelProviders(getRequestContext(meta));
    const envVars: Record<string, string | undefined> = {};
    for (const provider of providers) {
      const envVarName =
        "envVarName" in provider ? provider.envVarName : undefined;
      if (envVarName) {
        envVars[envVarName] = getEnvVar(envVarName);
      }
    }
    return envVars;
  },

  async "get-language-model-providers"(_args, meta) {
    return listLanguageModelProviders(getRequestContext(meta));
  },

  async "run-app"(args, meta) {
    const [params] = args as [{ appId?: number }];
    const appId = params?.appId;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    if (scopedContext) {
      await enforceAndRecordUsage({
        context: scopedContext,
        metricType: "concurrent_preview_jobs",
        value: 1,
      });
    }

    return withLock(appId, async () => {
      const originalPreviewUrl = getOriginalPreviewUrl(appId);
      if (runningApps.has(appId)) {
        if (await isPortOpen(getAppPort(appId))) {
          const proxiedPreviewUrl = await getOrCreatePreviewProxyUrl(appId);
          return {
            previewUrl: proxiedPreviewUrl,
            originalUrl: originalPreviewUrl,
          };
        }
        const staleAppInfo = runningApps.get(appId);
        if (staleAppInfo) {
          await stopAppByInfo(appId, staleAppInfo);
        }
        await stopPreviewProxyForApp(appId);
      }

      await cleanUpPort(getAppPort(appId));
      const startedPreview = await startPreviewAppForHttp(appId, scopedContext);
      if (scopedContext) {
        await writeAuditEvent({
          context: scopedContext,
          action: "preview_run",
          resourceType: "app",
          resourceId: appId,
        });
      }
      return startedPreview;
    });
  },

  async "stop-app"(args, meta) {
    const [params] = args as [{ appId?: number }];
    const appId = params?.appId;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    return withLock(appId, async () => {
      const appInfo = runningApps.get(appId);
      if (appInfo) {
        await stopAppByInfo(appId, appInfo);
      }
      await stopPreviewProxyForApp(appId);
      if (scopedContext) {
        await writeAuditEvent({
          context: scopedContext,
          action: "preview_stop",
          resourceType: "app",
          resourceId: appId,
        });
      }
      return;
    });
  },

  async "restart-app"(args, meta) {
    const [params] = args as [{ appId?: number; removeNodeModules?: boolean }];
    const appId = params?.appId;
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const scopedContext = getRequestContext(meta);
    return withLock(appId, async () => {
      const appInfo = runningApps.get(appId);
      if (appInfo) {
        await stopAppByInfo(appId, appInfo);
      }
      await stopPreviewProxyForApp(appId);

      if (params?.removeNodeModules) {
        const app = await db.query.apps.findFirst({
          where:
            scopedContext != null
              ? and(
                  eq(apps.id, appId),
                  eq(apps.organizationId, scopedContext.orgId),
                  eq(apps.workspaceId, scopedContext.workspaceId),
                )
              : eq(apps.id, appId),
          columns: { path: true },
        });
        if (!app) {
          throw new Error("App not found");
        }
        const nodeModulesPath = path.join(
          getBlazeAppPath(app.path),
          "node_modules",
        );
        await fs.promises.rm(nodeModulesPath, { recursive: true, force: true });
      }

      await cleanUpPort(getAppPort(appId));
      const startedPreview = await startPreviewAppForHttp(appId, scopedContext);
      if (scopedContext) {
        await writeAuditEvent({
          context: scopedContext,
          action: "preview_restart",
          resourceType: "app",
          resourceId: appId,
          metadata: {
            removeNodeModules: Boolean(params?.removeNodeModules),
          },
        });
      }
      return {
        success: true,
        previewUrl: startedPreview.previewUrl,
        originalUrl: startedPreview.originalUrl,
      };
    });
  },
};

const NON_DATABASE_CHANNELS = new Set([
  "get-user-settings",
  "set-user-settings",
  "get-oauth2-config",
  "exchange-oauth2-code",
  "get-app-version",
]);

export async function invokeIpcChannelOverHttp(
  channel: string,
  args: unknown[],
  meta?: InvokeMeta,
): Promise<unknown> {
  const handler = handlers[channel];
  if (!handler) {
    throw new Error(`Unsupported channel: ${channel}`);
  }

  if (!NON_DATABASE_CHANNELS.has(channel)) {
    await initializeDatabase();
  }
  return handler(args, meta);
}
