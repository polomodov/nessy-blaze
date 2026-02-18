type IpcChannelListener = (...args: unknown[]) => void;

export type BackendMode = "ipc" | "http";

export const BACKEND_MODE_STORAGE_KEY = "blaze.backend.mode";
export const BACKEND_BASE_URL_STORAGE_KEY = "blaze.backend.base_url";
export const BACKEND_IPC_FALLBACK_STORAGE_KEY = "blaze.backend.ipc_fallback";
export const TENANT_ORG_ID_STORAGE_KEY = "blaze.tenant.org_id";
export const TENANT_WORKSPACE_ID_STORAGE_KEY = "blaze.tenant.workspace_id";
export const AUTH_TOKEN_STORAGE_KEY = "blaze.auth.token";
export const DEV_USER_SUB_STORAGE_KEY = "blaze.dev.user_sub";
export const DEV_USER_EMAIL_STORAGE_KEY = "blaze.dev.user_email";
export const DEV_USER_NAME_STORAGE_KEY = "blaze.dev.user_name";

export interface BackendClient {
  invoke<T = any>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: IpcChannelListener): () => void;
  removeAllListeners(channel: string): void;
  removeListener(channel: string, listener: IpcChannelListener): void;
}

interface RemoteBackendConfig {
  mode?: BackendMode;
  baseUrl?: string;
  allowIpcFallback?: boolean;
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

const FORCE_IPC_CHANNELS = new Set<string>([
  "chat:stream",
  "chat:cancel",
  "respond-to-app-input",
  "github:start-flow",
  "help:chat:start",
  "help:chat:cancel",
]);

const IPC_HTTP_INVOKE_PATH = "/api/ipc/invoke";

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

function getLocalStorageValue(key: string): string | null {
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

function normalizeBackendMode(value: string | null | undefined): BackendMode {
  return value === "http" ? "http" : "ipc";
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

function isLikelyNetworkFetchError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror/i.test(message);
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
    case "get-user-settings":
      return {
        method: "GET",
        path: "/api/v1/user/settings",
      };
    case "set-user-settings":
      return {
        method: "PATCH",
        path: "/api/v1/user/settings",
        body: getFirstArg(args),
      };
    case "list-workspaces": {
      const params = getFirstArg<{ orgId?: string }>(args);
      const orgId = params?.orgId?.trim() || tenantScope.orgId;
      return {
        method: "GET",
        path: `/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
      };
    }
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
    default:
      return null;
  }
}

export function getConfiguredBackendMode(): BackendMode {
  const envMode = normalizeBackendMode(
    import.meta.env.VITE_BLAZE_BACKEND_MODE as string | undefined,
  );

  const remoteMode = window.__BLAZE_REMOTE_CONFIG__?.backendClient?.mode;
  const localMode = normalizeBackendMode(
    getLocalStorageValue(BACKEND_MODE_STORAGE_KEY),
  );

  if (localMode !== "ipc") {
    return localMode;
  }
  if (remoteMode === "http") {
    return remoteMode;
  }
  return envMode;
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

export function getAllowIpcFallback(): boolean {
  const localValue = getLocalStorageValue(BACKEND_IPC_FALLBACK_STORAGE_KEY);
  if (localValue != null) {
    return localValue !== "false";
  }

  const remoteValue =
    window.__BLAZE_REMOTE_CONFIG__?.backendClient?.allowIpcFallback;
  if (typeof remoteValue === "boolean") {
    return remoteValue;
  }

  const envValue = import.meta.env.VITE_BLAZE_BACKEND_ALLOW_IPC_FALLBACK as
    | string
    | undefined;
  if (envValue != null) {
    return envValue !== "false";
  }

  return true;
}

export class IpcBackendClient implements BackendClient {
  constructor(private readonly ipcRenderer: BackendClient) {}

  public invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
    return this.ipcRenderer.invoke(channel, ...args);
  }

  public on(channel: string, listener: IpcChannelListener): () => void {
    return this.ipcRenderer.on(channel, listener);
  }

  public removeAllListeners(channel: string): void {
    this.ipcRenderer.removeAllListeners(channel);
  }

  public removeListener(channel: string, listener: IpcChannelListener): void {
    this.ipcRenderer.removeListener(channel, listener);
  }
}

export class HttpBackendClient implements BackendClient {
  private readonly baseUrl: string | null;
  private readonly allowIpcFallback: boolean;

  constructor(private readonly fallbackClient: BackendClient) {
    this.baseUrl = getConfiguredBackendBaseUrl();
    this.allowIpcFallback = getAllowIpcFallback();
  }

  public async invoke<T = any>(
    channel: string,
    ...args: unknown[]
  ): Promise<T> {
    if (!this.baseUrl || FORCE_IPC_CHANNELS.has(channel)) {
      return this.fallbackClient.invoke<T>(channel, ...args);
    }

    try {
      const apiRoute = resolveApiRoute(
        channel,
        args,
        getConfiguredTenantScope(),
      );
      if (apiRoute) {
        return await invokeApiRoute<T>({
          baseUrl: this.baseUrl,
          channel,
          request: apiRoute,
        });
      }

      return await invokeOverHttp<T>({
        baseUrl: this.baseUrl,
        channel,
        args,
      });
    } catch (error) {
      if (!this.allowIpcFallback) {
        throw error;
      }

      console.warn(
        `[BackendClient] HTTP transport failed for "${channel}", falling back to IPC.`,
        error,
      );
      return this.fallbackClient.invoke<T>(channel, ...args);
    }
  }

  public on(channel: string, listener: IpcChannelListener): () => void {
    // Events are still forwarded through IPC while HTTP transport matures.
    return this.fallbackClient.on(channel, listener);
  }

  public removeAllListeners(channel: string): void {
    this.fallbackClient.removeAllListeners(channel);
  }

  public removeListener(channel: string, listener: IpcChannelListener): void {
    this.fallbackClient.removeListener(channel, listener);
  }
}

export class BrowserBackendClient implements BackendClient {
  private readonly baseUrls: string[];

  constructor() {
    const configuredBaseUrl = getConfiguredBackendBaseUrl();
    const originBaseUrl =
      typeof window !== "undefined" && window.location?.origin
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
    for (let index = 0; index < this.baseUrls.length; index += 1) {
      const baseUrl = this.baseUrls[index];
      const hasNextBaseUrl = index < this.baseUrls.length - 1;

      try {
        if (apiRoute) {
          return await invokeApiRoute<T>({
            baseUrl,
            channel,
            request: apiRoute,
          });
        }

        return await invokeOverHttp<T>({
          baseUrl,
          channel,
          args,
        });
      } catch (error) {
        if (!hasNextBaseUrl || !isLikelyNetworkFetchError(error)) {
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
    throw new Error(
      `Backend API failed for "${channel}" with status ${response.status}${
        errorText ? `: ${errorText}` : ""
      }`,
    );
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

async function invokeOverHttp<T>({
  baseUrl,
  channel,
  args,
}: {
  baseUrl: string;
  channel: string;
  args: unknown[];
}): Promise<T> {
  const headers = getDefaultRequestHeaders(channel);
  const scope = getConfiguredTenantScope();
  headers["x-blaze-org-id"] = scope.orgId;
  headers["x-blaze-workspace-id"] = scope.workspaceId;

  const response = await fetch(`${baseUrl}${IPC_HTTP_INVOKE_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ channel, args }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Backend invoke failed for "${channel}" with status ${response.status}${
        errorText ? `: ${errorText}` : ""
      }`,
    );
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
  ipcRenderer?: BackendClient,
): BackendClient {
  if (!ipcRenderer) {
    return new BrowserBackendClient();
  }

  const mode = getConfiguredBackendMode();
  if (mode === "http") {
    return new HttpBackendClient(ipcRenderer);
  }
  return new IpcBackendClient(ipcRenderer);
}
