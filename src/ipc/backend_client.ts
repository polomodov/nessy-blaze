type IpcChannelListener = (...args: unknown[]) => void;

export type BackendMode = "ipc" | "http";

export const BACKEND_MODE_STORAGE_KEY = "dyad.backend.mode";
export const BACKEND_BASE_URL_STORAGE_KEY = "dyad.backend.base_url";
export const BACKEND_IPC_FALLBACK_STORAGE_KEY = "dyad.backend.ipc_fallback";

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
}

declare global {
  interface Window {
    __DYAD_REMOTE_CONFIG__?: {
      backendClient?: RemoteBackendConfig;
    };
  }
}

const FORCE_IPC_CHANNELS = new Set<string>([
  "chat:stream",
  "chat:cancel",
  "run-app",
  "stop-app",
  "restart-app",
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

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function getFirstArg<T>(args: unknown[]): T | undefined {
  return args[0] as T | undefined;
}

function resolveApiRoute(
  channel: string,
  args: unknown[],
): HttpApiRequest | null {
  switch (channel) {
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
    case "list-apps":
      return {
        method: "GET",
        path: "/api/v1/apps",
      };
    case "get-app": {
      const appId = getFirstArg<number>(args);
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `/api/v1/apps/${appId}`,
      };
    }
    case "create-app":
      return {
        method: "POST",
        path: "/api/v1/apps",
        body: getFirstArg(args),
      };
    case "search-app": {
      const query = getFirstArg<string>(args);
      if (typeof query !== "string") {
        return null;
      }
      return {
        method: "GET",
        path: "/api/v1/apps:search",
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
        path: `/api/v1/apps/${params.appId}/favorite/toggle`,
      };
    }
    case "get-chats": {
      const appId = getFirstArg<number>(args);
      if (typeof appId === "number") {
        return {
          method: "GET",
          path: `/api/v1/apps/${appId}/chats`,
        };
      }
      return {
        method: "GET",
        path: "/api/v1/chats",
      };
    }
    case "create-chat": {
      const appId = getFirstArg<number>(args);
      if (typeof appId !== "number") {
        return null;
      }
      return {
        method: "POST",
        path: `/api/v1/apps/${appId}/chats`,
      };
    }
    case "get-chat": {
      const chatId = getFirstArg<number>(args);
      if (typeof chatId !== "number") {
        return null;
      }
      return {
        method: "GET",
        path: `/api/v1/chats/${chatId}`,
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
    import.meta.env.VITE_DYAD_BACKEND_MODE as string | undefined,
  );

  const remoteMode = window.__DYAD_REMOTE_CONFIG__?.backendClient?.mode;
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

  const remoteUrl = window.__DYAD_REMOTE_CONFIG__?.backendClient?.baseUrl;
  if (remoteUrl?.trim()) {
    return trimTrailingSlash(remoteUrl.trim());
  }

  const envUrl = import.meta.env.VITE_DYAD_BACKEND_URL as string | undefined;
  if (envUrl?.trim()) {
    return trimTrailingSlash(envUrl.trim());
  }

  return null;
}

function getAllowIpcFallback(): boolean {
  const localValue = getLocalStorageValue(BACKEND_IPC_FALLBACK_STORAGE_KEY);
  if (localValue != null) {
    return localValue !== "false";
  }

  const remoteValue =
    window.__DYAD_REMOTE_CONFIG__?.backendClient?.allowIpcFallback;
  if (typeof remoteValue === "boolean") {
    return remoteValue;
  }

  const envValue = import.meta.env.VITE_DYAD_BACKEND_ALLOW_IPC_FALLBACK as
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
      const apiRoute = resolveApiRoute(channel, args);
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
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl =
      getConfiguredBackendBaseUrl() ||
      (typeof window !== "undefined" ? window.location.origin : "");
  }

  public invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.baseUrl) {
      throw new Error(
        `Backend URL is not configured for channel "${channel}". Set VITE_DYAD_BACKEND_URL or remote config.`,
      );
    }

    const apiRoute = resolveApiRoute(channel, args);
    if (apiRoute) {
      return invokeApiRoute<T>({
        baseUrl: this.baseUrl,
        channel,
        request: apiRoute,
      });
    }

    return invokeOverHttp<T>({
      baseUrl: this.baseUrl,
      channel,
      args,
    });
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
  const response = await fetch(url, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      "X-Dyad-Channel": channel,
    },
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
  const response = await fetch(`${baseUrl}${IPC_HTTP_INVOKE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dyad-Channel": channel,
    },
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
