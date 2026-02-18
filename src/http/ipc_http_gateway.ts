import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { asc, desc, eq, ilike } from "drizzle-orm";
import git from "isomorphic-git";
import { initializeDatabase, db } from "../db";
import { apps, chats, messages, language_model_providers } from "../db/schema";
import { getBlazeAppPath, getUserDataPath } from "../paths/paths";
import { getEnvVar } from "../ipc/utils/read_env";
import {
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  PROVIDER_TO_ENV_VAR,
} from "../ipc/shared/language_model_constants";
import { UserSettingsSchema, type UserSettings } from "../lib/schemas";
import { DEFAULT_TEMPLATE_ID } from "../shared/templates";
import { DEFAULT_THEME_ID } from "../shared/themes";

type InvokeHandler = (args: unknown[]) => Promise<unknown>;

const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: randomUUID(),
  hasRunBefore: false,
  experiments: {},
  enableProLazyEditsMode: true,
  enableProSmartFilesContextMode: true,
  selectedChatMode: "build",
  enableAutoFixProblems: false,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  isRunning: false,
  enableNativeGit: true,
});

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
    return DEFAULT_USER_SETTINGS;
  }

  try {
    const rawSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return UserSettingsSchema.parse({
      ...DEFAULT_USER_SETTINGS,
      ...rawSettings,
    });
  } catch {
    return DEFAULT_USER_SETTINGS;
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
  return mergedSettings;
}

type AppRow = typeof apps.$inferSelect;
type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function mapAppRow(row: AppRow) {
  const appPath = String(row.path ?? "");
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    path: appPath,
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
    resolvedPath: getBlazeAppPath(appPath),
  };
}

function mapChatRow(row: ChatRow) {
  return {
    id: Number(row.id),
    appId: Number(row.appId),
    title: row.title ?? null,
    createdAt: toIsoDate(row.createdAt),
  };
}

function mapMessageRow(row: MessageRow) {
  return {
    id: Number(row.id),
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

export type HttpChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

export async function doesHttpChatExist(chatId: number): Promise<boolean> {
  await initializeDatabase();
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  return rows.length > 0;
}

export async function listHttpChatMessages(
  chatId: number,
): Promise<HttpChatMessage[]> {
  await initializeDatabase();
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
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
}): Promise<HttpChatMessage> {
  const { chatId, role, content } = params;
  await initializeDatabase();

  const [inserted] = await db
    .insert(messages)
    .values({ chatId, role, content })
    .returning({
      id: messages.id,
      role: messages.role,
      content: messages.content,
    });

  return {
    id: Number(inserted.id),
    role: inserted.role,
    content: inserted.content,
  };
}

async function listLanguageModelProviders() {
  await initializeDatabase();
  const customProviders = await db
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

const handlers: Record<string, InvokeHandler> = {
  async "get-user-settings"() {
    return readUserSettings();
  },

  async "set-user-settings"(args) {
    const [nextSettings] = args as [Partial<UserSettings>];
    if (!nextSettings || typeof nextSettings !== "object") {
      throw new Error("Invalid settings payload");
    }
    return writeUserSettings(nextSettings);
  },

  async "get-app-version"() {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return { version: packageJson.version };
  },

  async "list-apps"() {
    const rows = await db.select().from(apps).orderBy(desc(apps.createdAt));

    return {
      apps: rows.map(mapAppRow),
    };
  },

  async "search-app"(args) {
    const [searchQuery] = args as [string];
    if (typeof searchQuery !== "string") {
      throw new Error("Invalid search query");
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

  async "get-app"(args) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const row = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!row) {
      throw new Error("App not found");
    }

    return {
      ...mapAppRow(row),
      files: [],
    };
  },

  async "create-app"(args) {
    const [params] = args as [{ name?: string }];
    const appName = params?.name?.trim();

    if (!appName) {
      throw new Error("App name is required");
    }

    const appPath = `${sanitizePathName(appName)}-${Date.now()}`;
    const { initialCommitHash } = await ensureWorkspaceForApp(appPath);

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

  async "add-to-favorite"(args) {
    const [params] = args as [{ appId?: number }];
    const appId = params?.appId;

    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
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

  async "get-chats"(args) {
    const [appId] = args as [number | undefined];

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

  async "create-chat"(args) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
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

  async "get-chat"(args) {
    const [chatId] = args as [number];
    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
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

  async "get-env-vars"() {
    const providers = await listLanguageModelProviders();
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

  async "get-language-model-providers"() {
    return listLanguageModelProviders();
  },
};

const NON_DATABASE_CHANNELS = new Set([
  "get-user-settings",
  "set-user-settings",
  "get-app-version",
]);

export async function invokeIpcChannelOverHttp(
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const handler = handlers[channel];
  if (!handler) {
    throw new Error(`Unsupported channel: ${channel}`);
  }

  if (!NON_DATABASE_CHANNELS.has(channel)) {
    await initializeDatabase();
  }
  return handler(args);
}
