type IpcChannelListener = (...args: unknown[]) => void;

export const BACKEND_BASE_URL_STORAGE_KEY = "blaze.backend.base_url";
export const TENANT_ORG_ID_STORAGE_KEY = "blaze.tenant.org_id";
export const TENANT_WORKSPACE_ID_STORAGE_KEY = "blaze.tenant.workspace_id";
export const AUTH_TOKEN_STORAGE_KEY = "blaze.auth.token";
export const DEV_USER_SUB_STORAGE_KEY = "blaze.dev.user_sub";
export const DEV_USER_EMAIL_STORAGE_KEY = "blaze.dev.user_email";
export const DEV_USER_NAME_STORAGE_KEY = "blaze.dev.user_name";
export const AUTH_REDIRECT_REASON_STORAGE_KEY = "blaze.auth.redirect.reason";
export const AUTH_REDIRECT_REASON_SESSION_EXPIRED = "session-expired";

const OAUTH2_STATE_STORAGE_KEY = "blaze.auth.oauth2.state";
const OAUTH2_CODE_VERIFIER_STORAGE_KEY = "blaze.auth.oauth2.code_verifier";
const AUTH_SESSION_EXPIRED_ERROR_CODE = "AUTH_SESSION_EXPIRED";

export interface BackendClient {
  invoke<T = any>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: IpcChannelListener): () => void;
  removeAllListeners(channel: string): void;
  removeListener(channel: string, listener: IpcChannelListener): void;
}

interface RemoteBackendConfig {
  baseUrl?: string;
  orgId?: string;
  workspaceId?: string;
  authToken?: string;
  devUserSub?: string;
  devUserEmail?: string;
  devUserName?: string;
}

declare global {
  interface Window {
    __BLAZE_REMOTE_CONFIG__?: {
      backendClient?: RemoteBackendConfig;
    };
  }
}

interface HttpApiRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface TenantScope {
  orgId: string;
  workspaceId: string;
}

export class FeatureDisabledError extends Error {
  public readonly code = "FEATURE_DISABLED";

  constructor(
    message: string,
    public readonly channel?: string,
  ) {
    super(message);
    this.name = "FeatureDisabledError";
  }
}

function getLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage as Partial<Storage> | undefined;
  if (storage && typeof storage.getItem === "function") {
    return storage.getItem(key);
  }

  if (
    storage &&
    typeof (storage as Record<string, unknown>)[key] === "string"
  ) {
    return (storage as Record<string, string>)[key];
  }

  return null;
}

export function getConfiguredTenantScope(): TenantScope {
  const localOrgId = getLocalStorageValue(TENANT_ORG_ID_STORAGE_KEY);
  const localWorkspaceId = getLocalStorageValue(
    TENANT_WORKSPACE_ID_STORAGE_KEY,
  );
  const remoteOrgId = window.__BLAZE_REMOTE_CONFIG__?.backendClient?.orgId;
  const remoteWorkspaceId =
    window.__BLAZE_REMOTE_CONFIG__?.backendClient?.workspaceId;
  const envOrgId = import.meta.env.VITE_BLAZE_TENANT_ORG_ID as
    | string
    | undefined;
  const envWorkspaceId = import.meta.env.VITE_BLAZE_TENANT_WORKSPACE_ID as
    | string
    | undefined;

  const orgId =
    localOrgId?.trim() || remoteOrgId?.trim() || envOrgId?.trim() || "me";
  const workspaceId =
    localWorkspaceId?.trim() ||
    remoteWorkspaceId?.trim() ||
    envWorkspaceId?.trim() ||
    "me";

  return {
    orgId,
    workspaceId,
  };
}

function getAuthToken(): string | null {
  const localToken = getLocalStorageValue(AUTH_TOKEN_STORAGE_KEY);
  if (localToken?.trim()) {
    return localToken.trim();
  }
  const remoteToken = window.__BLAZE_REMOTE_CONFIG__?.backendClient?.authToken;
  if (remoteToken?.trim()) {
    return remoteToken.trim();
  }
  const envToken = import.meta.env.VITE_BLAZE_AUTH_TOKEN as string | undefined;
  if (envToken?.trim()) {
    return envToken.trim();
  }
  return null;
}

function getDevHeaderValue(
  localStorageKey: string,
  remoteValue?: string,
  envValue?: string,
): string | null {
  const localValue = getLocalStorageValue(localStorageKey);
  if (localValue?.trim()) {
    return localValue.trim();
  }
  if (remoteValue?.trim()) {
    return remoteValue.trim();
  }
  if (envValue?.trim()) {
    return envValue.trim();
  }
  return null;
}

export function getDefaultRequestHeaders(
  channel: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Blaze-Channel": channel,
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const remote = window.__BLAZE_REMOTE_CONFIG__?.backendClient;
  const devUserSub = getDevHeaderValue(
    DEV_USER_SUB_STORAGE_KEY,
    remote?.devUserSub,
    import.meta.env.VITE_BLAZE_DEV_USER_SUB as string | undefined,
  );
  const devUserEmail = getDevHeaderValue(
    DEV_USER_EMAIL_STORAGE_KEY,
    remote?.devUserEmail,
    import.meta.env.VITE_BLAZE_DEV_USER_EMAIL as string | undefined,
  );
  const devUserName = getDevHeaderValue(
    DEV_USER_NAME_STORAGE_KEY,
    remote?.devUserName,
    import.meta.env.VITE_BLAZE_DEV_USER_NAME as string | undefined,
  );

  if (devUserSub) {
    headers["x-blaze-dev-user-sub"] = devUserSub;
  }
  if (devUserEmail) {
    headers["x-blaze-dev-user-email"] = devUserEmail;
  }
  if (devUserName) {
    headers["x-blaze-dev-user-name"] = devUserName;
  }

  return headers;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function isHttpLikeOrigin(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isLikelyNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror/i.test(message);
}

function isAuthSessionExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: string }).code === AUTH_SESSION_EXPIRED_ERROR_CODE;
}

function extractBackendErrorMessage(errorText: string): string {
  if (!errorText.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(errorText) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Fall through to raw text.
  }

  return errorText.trim();
}

function removeStorageValue(
  storage: Storage | Partial<Storage> | undefined,
  key: string,
) {
  if (!storage) {
    return;
  }

  if (typeof storage.removeItem === "function") {
    storage.removeItem(key);
    return;
  }

  delete (storage as Record<string, unknown>)[key];
}

function clearExpiredAuthStorage() {
  if (typeof window === "undefined") {
    return;
  }

  removeStorageValue(window.localStorage, AUTH_TOKEN_STORAGE_KEY);
  removeStorageValue(window.localStorage, DEV_USER_SUB_STORAGE_KEY);
  removeStorageValue(window.localStorage, DEV_USER_EMAIL_STORAGE_KEY);
  removeStorageValue(window.localStorage, DEV_USER_NAME_STORAGE_KEY);
  removeStorageValue(window.sessionStorage, OAUTH2_STATE_STORAGE_KEY);
  removeStorageValue(window.sessionStorage, OAUTH2_CODE_VERIFIER_STORAGE_KEY);
}

function handleExpiredAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  clearExpiredAuthStorage();
  const hasSessionExpiredReason =
    window.sessionStorage.getItem(AUTH_REDIRECT_REASON_STORAGE_KEY) ===
    AUTH_REDIRECT_REASON_SESSION_EXPIRED;

  if (!hasSessionExpiredReason) {
    try {
      window.sessionStorage.setItem(
        AUTH_REDIRECT_REASON_STORAGE_KEY,
        AUTH_REDIRECT_REASON_SESSION_EXPIRED,
      );
    } catch {
      // Ignore storage errors and continue redirecting to sign-in.
    }
  }

  if (!hasSessionExpiredReason && window.location.pathname !== "/auth") {
    window.location.assign("/auth");
  }
}

function createBackendError(args: {
  channel: string;
  status: number;
  errorText: string;
}): Error {
  const normalizedErrorText = args.errorText.trim();
  const backendErrorMessage = extractBackendErrorMessage(normalizedErrorText);
  const isJwtExpired =
    args.status === 401 && /jwt\s+is\s+expired/i.test(backendErrorMessage);

  if (isJwtExpired) {
    handleExpiredAuthSession();
    const authError = new Error(
      "Authentication session expired. Please sign in again.",
    );
    (authError as { code?: string }).code = AUTH_SESSION_EXPIRED_ERROR_CODE;
    return authError;
  }

  return new Error(
    `Backend API failed for "${args.channel}" with status ${args.status}${
      normalizedErrorText ? `: ${normalizedErrorText}` : ""
    }`,
  );
}

function getFirstArg<T>(args: unknown[]): T | undefined {
  return args[0] as T | undefined;
}

function resolveApiRoute(
  channel: string,
  args: unknown[],
  tenantScope: TenantScope,
): HttpApiRequest | null {
  const scopedBasePath = `/api/v1/orgs/${encodeURIComponent(
    tenantScope.orgId,
  )}/workspaces/${encodeURIComponent(tenantScope.workspaceId)}`;

  switch (channel) {
    case "list-orgs":
      return {
        method: "GET",
        path: "/api/v1/orgs",
      };
    case "create-org":
      return {
        method: "POST",
        path: "/api/v1/orgs",
        body: getFirstArg(args),
      };
    case "get-org": {
      const params = getFirstArg<{ orgId?: string }>(args);
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      return {
        method: "GET",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}`,
      };
    }
    case "patch-org": {
      const params = getFirstArg<{ orgId?: string }>(args);
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      return {
        method: "PATCH",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}`,
        body: getFirstArg(args),
      };
    }
    case "list-workspaces": {
      const params = getFirstArg<{ orgId?: string }>(args);
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      return {
        method: "GET",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
      };
    }
    case "create-workspace": {
      const params = getFirstArg<{
        orgId?: string;
        name?: string;
        slug?: string;
        type?: "personal" | "team";
      }>(args);
      if (!params || typeof params.name !== "string") {
        return null;
      }

      const orgId = params.orgId?.trim() || tenantScope.orgId;
      const body: {
        name: string;
        slug?: string;
        type?: "personal" | "team";
      } = {
        name: params.name,
      };

      if (typeof params.slug === "string") {
        body.slug = params.slug;
      }
      if (params.type === "personal" || params.type === "team") {
        body.type = params.type;
      }

      return {
        method: "POST",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
        body,
      };
    }
    case "get-workspace": {
      const params = getFirstArg<{ orgId?: string; workspaceId?: string }>(
        args,
      );
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      const workspaceId =
        params?.workspaceId?.trim() || tenantScope.workspaceId;
      return {
        method: "GET",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      };
    }
    case "patch-workspace": {
      const params = getFirstArg<{ orgId?: string; workspaceId?: string }>(
        args,
      );
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      const workspaceId =
        params?.workspaceId?.trim() || tenantScope.workspaceId;
      return {
        method: "PATCH",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}`,
        body: getFirstArg(args),
      };
    }
    case "delete-workspace": {
      const params = getFirstArg<{ orgId?: string; workspaceId?: string }>(
        args,
      );
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      const workspaceId =
        params?.workspaceId?.trim() || tenantScope.workspaceId;
      return {
        method: "DELETE",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      };
    }
    case "get-user-settings":
      return {
        method: "GET",
        path: "/api/v1/settings/user",
      };
    case "set-user-settings":
      return {
        method: "PATCH",
        path: "/api/v1/settings/user",
        body: getFirstArg(args),
      };
    case "list-apps":
      return {
        method: "GET",
        path: `${scopedBasePath}/apps`,
      };
    case "get-app": {
      const appId = getFirstArg<number>(args);
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/apps/${appId}`,
      };
    }
    case "create-app":
      return {
        method: "POST",
        path: `${scopedBasePath}/apps`,
        body: getFirstArg(args),
      };
    case "search-app": {
      const query = getFirstArg<string>(args);
      if (typeof query !== "string") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/apps:search`,
        query: { q: query },
      };
    }
    case "add-to-favorite": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/favorite/toggle`,
      };
    }
    case "patch-app": {
      const appId = getFirstArg<number>(args);
      const payload = args[1];
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "PATCH",
        path: `${scopedBasePath}/apps/${appId}`,
        body: payload,
      };
    }
    case "delete-app": {
      const appId = getFirstArg<number>(args);
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "DELETE",
        path: `${scopedBasePath}/apps/${appId}`,
      };
    }
    case "run-app": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/run`,
      };
    }
    case "stop-app": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/stop`,
      };
    }
    case "restart-app": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/restart`,
        body: params,
      };
    }
    case "list-versions": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/apps/${params.appId}/versions`,
      };
    }
    case "checkout-version": {
      const params = getFirstArg<{ appId?: number; versionId?: string }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      if (typeof params.versionId !== "string" || !params.versionId) {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/versions/checkout`,
        body: params,
      };
    }
    case "get-current-branch": {
      const params = getFirstArg<{ appId?: number }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/apps/${params.appId}/branch`,
      };
    }
    case "revert-version": {
      const params = getFirstArg<{
        appId?: number;
        previousVersionId?: string;
        currentChatMessageId?: {
          chatId?: number;
          messageId?: number;
        };
      }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${params.appId}/versions/revert`,
        body: params,
      };
    }
    case "read-app-file": {
      const params = getFirstArg<{ appId?: number; filePath?: string }>(args);
      if (!params || typeof params.appId !== "number") {
        return null;
      }
      if (typeof params.filePath !== "string" || !params.filePath) {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/apps/${params.appId}/file`,
        query: { path: params.filePath },
      };
    }
    case "get-chats": {
      const appId = getFirstArg<number>(args);
      if (typeof appId === "number") {
        return {
          method: "GET",
          path: `${scopedBasePath}/apps/${appId}/chats`,
        };
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/chats`,
      };
    }
    case "create-chat": {
      const appId = getFirstArg<number>(args);
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/apps/${appId}/chats`,
      };
    }
    case "get-chat": {
      const chatId = getFirstArg<number>(args);
      if (typeof chatId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/chats/${chatId}`,
      };
    }
    case "update-chat": {
      const params = getFirstArg<{ chatId?: number }>(args);
      if (!params || typeof params.chatId !== "number") {
        return null;
      }
      return {
        method: "PATCH",
        path: `${scopedBasePath}/chats/${params.chatId}`,
        body: params,
      };
    }
    case "delete-chat": {
      const chatId = getFirstArg<number>(args);
      if (typeof chatId !== "number") {
        return null;
      }
      return {
        method: "DELETE",
        path: `${scopedBasePath}/chats/${chatId}`,
      };
    }
    case "get-proposal": {
      const params = getFirstArg<{ chatId?: number }>(args);
      if (!params || typeof params.chatId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `${scopedBasePath}/chats/${params.chatId}/proposal`,
      };
    }
    case "approve-proposal": {
      const params = getFirstArg<{ chatId?: number; messageId?: number }>(args);
      if (!params || typeof params.chatId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/chats/${params.chatId}/proposal/approve`,
        body: params,
      };
    }
    case "reject-proposal": {
      const params = getFirstArg<{ chatId?: number; messageId?: number }>(args);
      if (!params || typeof params.chatId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `${scopedBasePath}/chats/${params.chatId}/proposal/reject`,
        body: params,
      };
    }
    case "get-workspace-model-settings":
      return {
        method: "GET",
        path: `${scopedBasePath}/settings/models`,
      };
    case "set-workspace-model-settings":
      return {
        method: "PATCH",
        path: `${scopedBasePath}/settings/models`,
        body: getFirstArg(args),
      };
    case "get-workspace-env-providers":
      return {
        method: "GET",
        path: `${scopedBasePath}/env/providers`,
      };
    case "get-env-vars":
      return {
        method: "GET",
        path: "/api/v1/env-vars",
      };
    case "get-language-model-providers":
      return {
        method: "GET",
        path: "/api/v1/language-model/providers",
      };
    case "get-app-version":
      return {
        method: "GET",
        path: "/api/v1/app/version",
      };
    case "get-oauth2-config":
      return {
        method: "GET",
        path: "/api/v1/auth/oauth/config",
      };
    case "exchange-oauth2-code":
      return {
        method: "POST",
        path: "/api/v1/auth/oauth/exchange",
        body: getFirstArg(args),
      };
    default:
      return null;
  }
}

export function getConfiguredBackendBaseUrl(): string | null {
  const localUrl = getLocalStorageValue(BACKEND_BASE_URL_STORAGE_KEY);
  if (localUrl?.trim()) {
    return trimTrailingSlash(localUrl.trim());
  }

  const remoteUrl = window.__BLAZE_REMOTE_CONFIG__?.backendClient?.baseUrl;
  if (remoteUrl?.trim()) {
    return trimTrailingSlash(remoteUrl.trim());
  }

  const envUrl = import.meta.env.VITE_BLAZE_BACKEND_URL as string | undefined;
  if (envUrl?.trim()) {
    return trimTrailingSlash(envUrl.trim());
  }

  return null;
}

export class BrowserBackendClient implements BackendClient {
  private readonly baseUrls: string[];

  constructor() {
    const configuredBaseUrl = getConfiguredBackendBaseUrl();
    const originBaseUrl =
      typeof window !== "undefined" && isHttpLikeOrigin(window.location?.origin)
        ? trimTrailingSlash(window.location.origin)
        : "";

    const urls: string[] = [];
    if (configuredBaseUrl) {
      urls.push(configuredBaseUrl);
    }
    if (originBaseUrl && !urls.includes(originBaseUrl)) {
      urls.push(originBaseUrl);
    }

    this.baseUrls = urls;
  }

  public async invoke<T = any>(
    channel: string,
    ...args: unknown[]
  ): Promise<T> {
    if (this.baseUrls.length === 0) {
      throw new Error(
        `Backend URL is not configured for channel "${channel}". Set VITE_BLAZE_BACKEND_URL or remote config.`,
      );
    }

    const apiRoute = resolveApiRoute(channel, args, getConfiguredTenantScope());
    if (!apiRoute) {
      throw new FeatureDisabledError(
        `Feature "${channel}" is disabled in HTTP-only mode.`,
        channel,
      );
    }

    for (let index = 0; index < this.baseUrls.length; index += 1) {
      const baseUrl = this.baseUrls[index];
      const hasNextBaseUrl = index < this.baseUrls.length - 1;

      try {
        return await invokeApiRoute<T>({
          baseUrl,
          channel,
          request: apiRoute,
        });
      } catch (error) {
        if (
          isAuthSessionExpiredError(error) ||
          !hasNextBaseUrl ||
          !isLikelyNetworkFetchError(error)
        ) {
          throw error;
        }

        console.warn(
          `[BackendClient] Request for "${channel}" failed against "${baseUrl}". Retrying with "${this.baseUrls[index + 1]}".`,
          error,
        );
      }
    }

    throw new Error(`Failed to invoke backend channel "${channel}".`);
  }

  public on(_channel: string, _listener: IpcChannelListener): () => void {
    // Browser mode does not have IPC event subscriptions.
    // Streaming and push updates should be implemented over HTTP/SSE/WebSocket.
    return () => {};
  }

  public removeAllListeners(_channel: string): void {}

  public removeListener(
    _channel: string,
    _listener: IpcChannelListener,
  ): void {}
}

function getFetchPathWithQuery(
  path: string,
  query?: Record<string, string>,
): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }

  const queryString = new URLSearchParams(query).toString();
  return `${path}?${queryString}`;
}

async function invokeApiRoute<T>({
  baseUrl,
  channel,
  request,
}: {
  baseUrl: string;
  channel: string;
  request: HttpApiRequest;
}): Promise<T> {
  const url = `${baseUrl}${getFetchPathWithQuery(request.path, request.query)}`;
  const headers = getDefaultRequestHeaders(channel);
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw createBackendError({
      channel,
      status: response.status,
      errorText,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "data" in (payload as Record<string, unknown>)
    ) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  }

  return (await response.text()) as T;
}

export function createBackendClientTransport(
  _ipcRenderer?: BackendClient,
): BackendClient {
  return new BrowserBackendClient();
}
