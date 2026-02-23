import { getEnvVar } from "/src/ipc/utils/read_env.ts";

export type MultitenantMode = "shadow" | "enforce";

function readFlag(name: string): string | undefined {
  return process.env[name] ?? getEnvVar(name);
}

function readBooleanFlag(name: string, defaultValue: boolean): boolean {
  const raw = readFlag(name);
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

export function getMultitenantMode(): MultitenantMode {
  const value = (readFlag("MULTITENANT_MODE") ?? "shadow").trim().toLowerCase();
  return value === "enforce" ? "enforce" : "shadow";
}

export function isMultitenantEnforced(): boolean {
  return getMultitenantMode() === "enforce";
}

export function isWebSocketStreamingEnabled(): boolean {
  return readBooleanFlag("WS_STREAMING_ENABLED", true);
}

export function isDevBypassEnabled(): boolean {
  const isProduction =
    (process.env.NODE_ENV ?? "").toLowerCase() === "production";
  if (isProduction) {
    return false;
  }
  return readBooleanFlag("AUTH_DEV_BYPASS_ENABLED", true);
}
