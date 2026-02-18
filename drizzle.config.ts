import type { Config } from "drizzle-kit";
import { getEnvVar } from "./src/ipc/utils/read_env";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  getEnvVar("DATABASE_URL") ||
  getEnvVar("POSTGRES_URL");

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set (fallback: POSTGRES_URL). Configure Postgres connection before running drizzle commands.",
  );
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
