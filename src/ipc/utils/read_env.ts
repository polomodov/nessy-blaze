import { shellEnvSync } from "shell-env";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Need to look up run-time env vars this way
// otherwise it doesn't work as expected in MacOs apps:
// https://github.com/sindresorhus/shell-env

let _env: Record<string, string> | null = null;

function readDotenvFilesFromCwd(): Record<string, string> {
  const cwd = process.cwd();
  const dotenvFilePaths = [
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
  ];
  const merged: Record<string, string> = {};

  for (const filePath of dotenvFilePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const parsed = dotenv.parse(fs.readFileSync(filePath, "utf-8"));
    Object.assign(merged, parsed);
  }

  return merged;
}

function readProcessEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return merged;
}

export function getEnvVar(key: string) {
  // Cache it
  if (!_env) {
    let shellEnv: Record<string, string> = {};
    try {
      shellEnv = shellEnvSync();
    } catch {
      shellEnv = {};
    }

    const dotenvEnv = readDotenvFilesFromCwd();
    const processEnv = readProcessEnv();
    _env = {
      ...shellEnv,
      ...dotenvEnv,
      ...processEnv,
    };
  }
  return _env[key];
}
