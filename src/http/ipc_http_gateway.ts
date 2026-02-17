import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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
type SqliteStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { lastInsertRowid: number | bigint };
};

type SqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
};

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

type NodeSqliteModule = {
  DatabaseSync: SqliteDatabaseConstructor;
};

let sqlite: SqliteDatabase | null = null;
const require = createRequire(import.meta.url);

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

function toIsoDate(value: number | string | null | undefined): string | null {
  if (value == null) {
    return null;
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

function getDatabasePath(): string {
  return path.join(getUserDataPath(), "sqlite.db");
}

function ensureSchema(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      github_org TEXT,
      github_repo TEXT,
      github_branch TEXT,
      supabase_project_id TEXT,
      supabase_parent_project_id TEXT,
      supabase_organization_slug TEXT,
      neon_project_id TEXT,
      neon_development_branch_id TEXT,
      neon_preview_branch_id TEXT,
      vercel_project_id TEXT,
      vercel_project_name TEXT,
      vercel_team_id TEXT,
      vercel_deployment_url TEXT,
      install_command TEXT,
      start_command TEXT,
      chat_context TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      theme_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      title TEXT,
      initial_commit_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      approval_state TEXT,
      source_commit_hash TEXT,
      commit_hash TEXT,
      request_id TEXT,
      max_tokens_used INTEGER,
      model TEXT,
      ai_messages_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS language_model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      env_var_name TEXT,
      trust_self_signed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

function isNodeSqliteUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("No such built-in module: node:sqlite") ||
    error.message.includes("Cannot find module 'node:sqlite'")
  );
}

function resolveSqliteConstructor(): SqliteDatabaseConstructor {
  try {
    const sqliteModule = require("node:sqlite") as NodeSqliteModule;
    if (typeof sqliteModule.DatabaseSync === "function") {
      return sqliteModule.DatabaseSync;
    }
    throw new Error('Unexpected "node:sqlite" module shape');
  } catch (error) {
    if (!isNodeSqliteUnavailableError(error)) {
      throw error;
    }
  }

  const BetterSqlite3 = require("better-sqlite3") as SqliteDatabaseConstructor;
  if (typeof BetterSqlite3 !== "function") {
    throw new Error('Unexpected "better-sqlite3" module shape');
  }
  return BetterSqlite3;
}

function getSqlite(): SqliteDatabase {
  if (sqlite) {
    return sqlite;
  }

  const DatabaseSync = resolveSqliteConstructor();
  const databasePath = getDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  sqlite = new DatabaseSync(databasePath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(sqlite);
  return sqlite;
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

function mapAppRow(row: Record<string, unknown>) {
  const appPath = String(row.path ?? "");
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    path: appPath,
    createdAt: toIsoDate(row.created_at as number | string),
    updatedAt: toIsoDate(row.updated_at as number | string),
    githubOrg: (row.github_org as string | null) ?? null,
    githubRepo: (row.github_repo as string | null) ?? null,
    githubBranch: (row.github_branch as string | null) ?? null,
    supabaseProjectId: (row.supabase_project_id as string | null) ?? null,
    supabaseParentProjectId:
      (row.supabase_parent_project_id as string | null) ?? null,
    supabaseProjectName: null,
    supabaseOrganizationSlug:
      (row.supabase_organization_slug as string | null) ?? null,
    neonProjectId: (row.neon_project_id as string | null) ?? null,
    neonDevelopmentBranchId:
      (row.neon_development_branch_id as string | null) ?? null,
    neonPreviewBranchId: (row.neon_preview_branch_id as string | null) ?? null,
    vercelProjectId: (row.vercel_project_id as string | null) ?? null,
    vercelProjectName: (row.vercel_project_name as string | null) ?? null,
    vercelTeamSlug: null,
    vercelDeploymentUrl: (row.vercel_deployment_url as string | null) ?? null,
    installCommand: (row.install_command as string | null) ?? null,
    startCommand: (row.start_command as string | null) ?? null,
    isFavorite: Boolean(row.is_favorite),
    resolvedPath: getBlazeAppPath(appPath),
  };
}

function mapChatRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    appId: Number(row.app_id),
    title: (row.title as string | null) ?? null,
    createdAt: toIsoDate(row.created_at as number | string),
  };
}

function mapMessageRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    chatId: Number(row.chat_id),
    role: String(row.role),
    content: String(row.content ?? ""),
    approvalState: (row.approval_state as string | null) ?? null,
    sourceCommitHash: (row.source_commit_hash as string | null) ?? null,
    commitHash: (row.commit_hash as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    maxTokensUsed:
      row.max_tokens_used == null ? null : Number(row.max_tokens_used),
    model: (row.model as string | null) ?? null,
    aiMessagesJson: (row.ai_messages_json as unknown) ?? null,
    createdAt: toIsoDate(row.created_at as number | string),
  };
}

export type HttpChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

export function doesHttpChatExist(chatId: number): boolean {
  const database = getSqlite();
  const row = database
    .prepare("SELECT id FROM chats WHERE id = ? LIMIT 1")
    .get(chatId);
  return Boolean(row);
}

export function listHttpChatMessages(chatId: number): HttpChatMessage[] {
  const database = getSqlite();
  const rows = database
    .prepare(
      `SELECT id, role, content
       FROM messages
       WHERE chat_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(chatId) as Array<{
    id: number;
    role: string;
    content: string;
  }>;

  return rows.map((row) => ({
    id: Number(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content ?? ""),
  }));
}

export function insertHttpChatMessage(params: {
  chatId: number;
  role: "user" | "assistant";
  content: string;
}): HttpChatMessage {
  const { chatId, role, content } = params;
  const database = getSqlite();

  const inserted = database
    .prepare(
      `INSERT INTO messages (chat_id, role, content, created_at)
       VALUES (?, ?, ?, unixepoch())`,
    )
    .run(chatId, role, content);

  return {
    id: Number(inserted.lastInsertRowid),
    role,
    content,
  };
}

async function listLanguageModelProviders() {
  const database = getSqlite();
  const customProviders = database
    .prepare(
      `SELECT id, name, api_base_url, env_var_name, trust_self_signed
       FROM language_model_providers`,
    )
    .all() as Array<{
    id: string;
    name: string;
    api_base_url: string;
    env_var_name: string | null;
    trust_self_signed: number | null;
  }>;

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
    const database = getSqlite();
    const rows = database
      .prepare("SELECT * FROM apps ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];

    return {
      apps: rows.map(mapAppRow),
    };
  },

  async "search-app"(args) {
    const [searchQuery] = args as [string];
    if (typeof searchQuery !== "string") {
      throw new Error("Invalid search query");
    }

    const database = getSqlite();
    const rows = database
      .prepare(
        `SELECT id, name, created_at
         FROM apps
         WHERE name LIKE ?
         ORDER BY created_at DESC`,
      )
      .all(`%${searchQuery}%`) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      createdAt: toIsoDate(row.created_at as number | string),
      matchedChatTitle: null,
      matchedChatMessage: null,
    }));
  },

  async "get-app"(args) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const database = getSqlite();
    const row = database
      .prepare("SELECT * FROM apps WHERE id = ? LIMIT 1")
      .get(appId) as Record<string, unknown> | undefined;

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
    const database = getSqlite();

    const appInsert = database
      .prepare(
        `INSERT INTO apps (name, path, created_at, updated_at, is_favorite)
         VALUES (?, ?, unixepoch(), unixepoch(), 0)`,
      )
      .run(appName, appPath);

    const appId = Number(appInsert.lastInsertRowid);

    const chatInsert = database
      .prepare(
        `INSERT INTO chats (app_id, title, initial_commit_hash, created_at)
         VALUES (?, NULL, NULL, unixepoch())`,
      )
      .run(appId);

    const appRow = database
      .prepare("SELECT * FROM apps WHERE id = ? LIMIT 1")
      .get(appId) as Record<string, unknown>;

    return {
      app: mapAppRow(appRow),
      chatId: Number(chatInsert.lastInsertRowid),
    };
  },

  async "add-to-favorite"(args) {
    const [params] = args as [{ appId?: number }];
    const appId = params?.appId;

    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const database = getSqlite();
    const currentRow = database
      .prepare("SELECT is_favorite FROM apps WHERE id = ? LIMIT 1")
      .get(appId) as { is_favorite: number } | undefined;

    if (!currentRow) {
      throw new Error("App not found");
    }

    const nextFavoriteState = currentRow.is_favorite ? 0 : 1;
    database
      .prepare(
        "UPDATE apps SET is_favorite = ?, updated_at = unixepoch() WHERE id = ?",
      )
      .run(nextFavoriteState, appId);

    return { isFavorite: Boolean(nextFavoriteState) };
  },

  async "get-chats"(args) {
    const [appId] = args as [number | undefined];
    const database = getSqlite();

    const rows =
      typeof appId === "number"
        ? (database
            .prepare(
              `SELECT id, app_id, title, created_at
               FROM chats
               WHERE app_id = ?
               ORDER BY created_at DESC`,
            )
            .all(appId) as Record<string, unknown>[])
        : (database
            .prepare(
              `SELECT id, app_id, title, created_at
               FROM chats
               ORDER BY created_at DESC`,
            )
            .all() as Record<string, unknown>[]);

    return rows.map(mapChatRow);
  },

  async "create-chat"(args) {
    const [appId] = args as [number];
    if (typeof appId !== "number") {
      throw new Error("Invalid app ID");
    }

    const database = getSqlite();
    const appExists = database
      .prepare("SELECT id FROM apps WHERE id = ? LIMIT 1")
      .get(appId);

    if (!appExists) {
      throw new Error("App not found");
    }

    const inserted = database
      .prepare(
        `INSERT INTO chats (app_id, title, initial_commit_hash, created_at)
         VALUES (?, NULL, NULL, unixepoch())`,
      )
      .run(appId);

    return Number(inserted.lastInsertRowid);
  },

  async "get-chat"(args) {
    const [chatId] = args as [number];
    if (typeof chatId !== "number") {
      throw new Error("Invalid chat ID");
    }

    const database = getSqlite();
    const chatRow = database
      .prepare(
        `SELECT id, app_id, title, initial_commit_hash, created_at
         FROM chats
         WHERE id = ?
         LIMIT 1`,
      )
      .get(chatId) as Record<string, unknown> | undefined;

    if (!chatRow) {
      throw new Error("Chat not found");
    }

    const messageRows = database
      .prepare(
        `SELECT *
         FROM messages
         WHERE chat_id = ?
         ORDER BY created_at ASC`,
      )
      .all(chatId) as Record<string, unknown>[];

    return {
      id: Number(chatRow.id),
      appId: Number(chatRow.app_id),
      title: (chatRow.title as string | null) ?? null,
      initialCommitHash: (chatRow.initial_commit_hash as string | null) ?? null,
      createdAt: toIsoDate(chatRow.created_at as number | string),
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

export async function invokeIpcChannelOverHttp(
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const handler = handlers[channel];
  if (!handler) {
    throw new Error(`Unsupported channel: ${channel}`);
  }
  return handler(args);
}
