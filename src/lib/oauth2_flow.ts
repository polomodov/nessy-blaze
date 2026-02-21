export const OAUTH2_STATE_STORAGE_KEY = "blaze.auth.oauth2.state";
export const OAUTH2_CODE_VERIFIER_STORAGE_KEY =
  "blaze.auth.oauth2.code_verifier";
export const OAUTH2_REDIRECT_URI_STORAGE_KEY = "blaze.auth.oauth2.redirect_uri";

export interface OAuth2PublicConfig {
  enabled: boolean;
  providerName: string;
  authorizationUrl: string | null;
  clientId: string | null;
  scope: string;
  redirectUri: string | null;
  extraAuthParams: Record<string, string>;
}

export interface OAuth2TokenExchangeResult {
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  expiresIn: number | null;
  scope: string | null;
}

export interface OAuth2ResolvedRedirectUri {
  redirectUri: string;
  requiresOriginSwitch: boolean;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBytes(size: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto API is unavailable");
  }
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function createOAuth2State(): string {
  return toBase64Url(randomBytes(24));
}

export function createPkceCodeVerifier(): string {
  return toBase64Url(randomBytes(48));
}

export async function createPkceCodeChallenge(
  codeVerifier: string,
): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error("Web Crypto subtle API is unavailable");
  }
  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return toBase64Url(new Uint8Array(digest));
}

export function buildOAuth2AuthorizationUrl(params: {
  config: OAuth2PublicConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  if (!params.config.authorizationUrl || !params.config.clientId) {
    throw new Error("OAuth2 config is incomplete");
  }

  const authorizationUrl = new URL(params.config.authorizationUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", params.config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", params.redirectUri);
  authorizationUrl.searchParams.set("scope", params.config.scope);
  authorizationUrl.searchParams.set("state", params.state);
  authorizationUrl.searchParams.set("code_challenge", params.codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  for (const [key, value] of Object.entries(params.config.extraAuthParams)) {
    authorizationUrl.searchParams.set(key, value);
  }

  return authorizationUrl.toString();
}

export function resolveOAuthRedirectUri(params: {
  configuredRedirectUri?: string | null;
  currentOrigin: string;
}): OAuth2ResolvedRedirectUri {
  const currentRedirectUri = `${params.currentOrigin}/auth`;
  const configured = params.configuredRedirectUri?.trim();
  if (!configured) {
    return {
      redirectUri: currentRedirectUri,
      requiresOriginSwitch: false,
    };
  }

  try {
    const configuredUrl = new URL(configured);
    const currentOriginUrl = new URL(params.currentOrigin);
    return {
      redirectUri: configuredUrl.toString(),
      requiresOriginSwitch: configuredUrl.origin !== currentOriginUrl.origin,
    };
  } catch {
    return {
      redirectUri: currentRedirectUri,
      requiresOriginSwitch: false,
    };
  }
}

export function hasOAuth2CallbackParams(search: string): boolean {
  const searchParams = new URLSearchParams(search);
  return searchParams.has("code") || searchParams.has("error");
}

function decodeBase64UrlSegment(segment: string): string | null {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingLength);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

export function parseJwtClaimsUnsafe(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = decodeBase64UrlSegment(parts[1]);
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
