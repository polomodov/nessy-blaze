import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "/src/db/schema.ts";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { log } from "/src/lib/logger.ts";
import { getEnvVar } from "/src/ipc/utils/read_env.ts";

const logger = log.scope("db");
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

type BlazeDatabase = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

const RESET_TABLES = [
  "audit_events",
  "usage_events",
  "user_soft_quotas",
  "organization_quotas",
  "workspace_model_settings",
  "workspace_memberships",
  "organization_memberships",
  "workspaces",
  "organizations",
  "users",
  "tenant_migration_markers",
  "messages",
  "chats",
  "versions",
  "apps",
  "prompts",
  "language_models",
  "language_model_providers",
  "mcp_tool_consents",
  "mcp_servers",
] as const;

function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(moduleDirectory, "..", "..", "drizzle"),
    path.resolve(process.cwd(), "drizzle"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function getDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    getEnvVar("DATABASE_URL") ||
    getEnvVar("POSTGRES_URL");

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set (fallback: POSTGRES_URL). Configure Postgres connection before launching Blaze.",
    );
  }

  return url;
}

let _db: BlazeDatabase | null = null;
let _pool: Pool | null = null;
let _initPromise: Promise<BlazeDatabase> | null = null;

export async function initializeDatabase(): Promise<BlazeDatabase> {
  if (_db) {
    return _db;
  }

  if (_initPromise) {
    return _initPromise;
  }

  _initPromise = (async () => {
    const databaseUrl = getDatabaseUrl();
    logger.log("Initializing PostgreSQL database connection...");

    const pool = new Pool({ connectionString: databaseUrl });
    const database = drizzle(pool, { schema }) as BlazeDatabase;

    try {
      const migrationsFolder = resolveMigrationsFolder();
      if (!fs.existsSync(migrationsFolder)) {
        logger.error("Migrations folder not found:", migrationsFolder);
      } else {
        logger.log("Running migrations from:", migrationsFolder);
        await migrate(database, { migrationsFolder });
      }

      _pool = pool;
      _db = database;
      logger.log("PostgreSQL database initialized");
      return database;
    } catch (error) {
      logger.error("Failed to initialize PostgreSQL database:", error);
      await pool.end().catch((poolError) => {
        logger.error(
          "Failed to close PostgreSQL pool after init error:",
          poolError,
        );
      });
      throw error;
    }
  })();

  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

export function getDb(): BlazeDatabase {
  if (!_db) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return _db;
}

export async function closeDatabase(): Promise<void> {
  const pool = _pool;
  _db = null;
  _pool = null;

  if (pool) {
    await pool.end();
  }
}

export async function resetDatabaseState(): Promise<void> {
  const database = await initializeDatabase();
  const tables = RESET_TABLES.map((table) => `"${table}"`).join(", ");
  await database.execute(
    sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`),
  );
}

export const db = new Proxy({} as BlazeDatabase, {
  get(_target, prop) {
    const database = getDb();
    return database[prop as keyof BlazeDatabase];
  },
}) as BlazeDatabase;
