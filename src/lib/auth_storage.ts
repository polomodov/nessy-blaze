import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
} from "@/ipc/backend_client";

const AUTH_STORAGE_KEYS = [
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
] as const;

function hasNonEmptyValue(
  storage: Pick<Storage, "getItem">,
  key: string,
): boolean {
  const value = storage.getItem(key);
  return typeof value === "string" && value.trim().length > 0;
}

export function hasStoredAuthContext(
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  const targetStorage =
    storage ?? (typeof window !== "undefined" ? window.localStorage : null);

  if (!targetStorage || typeof targetStorage.getItem !== "function") {
    return false;
  }

  return AUTH_STORAGE_KEYS.some((key) => hasNonEmptyValue(targetStorage, key));
}

export function clearStoredAuthContext(
  storage?: Pick<Storage, "removeItem"> | null,
) {
  const targetStorage =
    storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!targetStorage || typeof targetStorage.removeItem !== "function") {
    return;
  }

  for (const key of AUTH_STORAGE_KEYS) {
    targetStorage.removeItem(key);
  }
}
