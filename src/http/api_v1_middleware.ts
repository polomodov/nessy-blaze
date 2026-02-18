import type { IncomingMessage, ServerResponse } from "node:http";
import { isMultitenantEnforced } from "./feature_flags";
import { isHttpError } from "./http_errors";
import type { IpcInvokeHandler } from "./ipc_http_middleware";
import { resolveRequestContext } from "./request_context";

type Next = (error?: unknown) => void;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface TenantPathParams {
  orgId?: string;
  workspaceId?: string;
}

interface RouteMatchResult {
  channel: string;
  args: unknown[];
  tenantPath?: TenantPathParams;
  requiresAuth: boolean;
}

interface RouteDefinition {
  method: HttpMethod;
  pattern: RegExp;
  build: (
    requestUrl: URL,
    match: RegExpMatchArray,
    body: unknown,
  ) => RouteMatchResult | null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk.toString();
  }

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

const SCOPED_ROUTES: RouteDefinition[] = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs$/,
    build: () => ({
      channel: "list-orgs",
      args: [],
      requiresAuth: true,
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/orgs$/,
    build: (_url, _match, body) => ({
      channel: "create-org",
      args: [body],
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)$/,
    build: (_url, match) => ({
      channel: "get-org",
      args: [],
      tenantPath: { orgId: match[1] },
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/orgs\/([^/]+)$/,
    build: (_url, match, body) => ({
      channel: "patch-org",
      args: [body],
      tenantPath: { orgId: match[1] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces$/,
    build: (_url, match) => ({
      channel: "list-workspaces",
      args: [],
      tenantPath: { orgId: match[1] },
      requiresAuth: true,
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces$/,
    build: (_url, match, body) => ({
      channel: "create-workspace",
      args: [body],
      tenantPath: { orgId: match[1] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)$/,
    build: (_url, match) => ({
      channel: "get-workspace",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)$/,
    build: (_url, match, body) => ({
      channel: "patch-workspace",
      args: [body],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)$/,
    build: (_url, match) => ({
      channel: "delete-workspace",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps$/,
    build: (_url, match) => ({
      channel: "list-apps",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps$/,
    build: (_url, match, body) => ({
      channel: "create-app",
      args: [body],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps:search$/,
    build: (url, match) => ({
      channel: "search-app",
      args: [url.searchParams.get("q") ?? ""],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "get-app",
        args: [appId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/favorite\/toggle$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "add-to-favorite",
        args: [{ appId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)$/,
    build: (_url, match, body) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "patch-app",
        args: [appId, body],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "delete-app",
        args: [appId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/run$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "run-app",
        args: [{ appId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/stop$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "stop-app",
        args: [{ appId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/restart$/,
    build: (_url, match, body) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      const payload =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : {};
      return {
        channel: "restart-app",
        args: [{ appId, ...payload }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/chats$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "get-chats",
        args: [appId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/chats$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "create-chat",
        args: [appId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)$/,
    build: (_url, match) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      return {
        channel: "get-chat",
        args: [chatId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats$/,
    build: (_url, match) => ({
      channel: "get-chats",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)$/,
    build: (_url, match, body) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      return {
        channel: "update-chat",
        args: [{ ...(body as object), chatId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)$/,
    build: (_url, match) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      return {
        channel: "delete-chat",
        args: [chatId],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/settings\/models$/,
    build: (_url, match) => ({
      channel: "get-workspace-model-settings",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/settings\/models$/,
    build: (_url, match, body) => ({
      channel: "set-workspace-model-settings",
      args: [body],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/env\/providers$/,
    build: (_url, match) => ({
      channel: "get-workspace-env-providers",
      args: [],
      tenantPath: { orgId: match[1], workspaceId: match[2] },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/app\/version$/,
    build: () => ({
      channel: "get-app-version",
      args: [],
      requiresAuth: false,
    }),
  },
];

const LEGACY_ROUTES: RouteDefinition[] = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/user\/settings$/,
    build: () => ({
      channel: "get-user-settings",
      args: [],
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/user\/settings$/,
    build: (_url, _match, body) => ({
      channel: "set-user-settings",
      args: [body],
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps$/,
    build: () => ({
      channel: "list-apps",
      args: [],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/apps$/,
    build: (_url, _match, body) => ({
      channel: "create-app",
      args: [body],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps:search$/,
    build: (url) => ({
      channel: "search-app",
      args: [url.searchParams.get("q") ?? ""],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps\/(\d+)$/,
    build: (_url, match) => {
      const appId = parseNumber(match[1]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "get-app",
        args: [appId],
        tenantPath: { orgId: "me", workspaceId: "me" },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/apps\/(\d+)\/favorite\/toggle$/,
    build: (_url, match) => {
      const appId = parseNumber(match[1]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "add-to-favorite",
        args: [{ appId }],
        tenantPath: { orgId: "me", workspaceId: "me" },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/chats$/,
    build: () => ({
      channel: "get-chats",
      args: [],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps\/(\d+)\/chats$/,
    build: (_url, match) => {
      const appId = parseNumber(match[1]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "get-chats",
        args: [appId],
        tenantPath: { orgId: "me", workspaceId: "me" },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/apps\/(\d+)\/chats$/,
    build: (_url, match) => {
      const appId = parseNumber(match[1]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "create-chat",
        args: [appId],
        tenantPath: { orgId: "me", workspaceId: "me" },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/chats\/(\d+)$/,
    build: (_url, match) => {
      const chatId = parseNumber(match[1]);
      if (chatId == null) {
        return null;
      }
      return {
        channel: "get-chat",
        args: [chatId],
        tenantPath: { orgId: "me", workspaceId: "me" },
        requiresAuth: true,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/env-vars$/,
    build: () => ({
      channel: "get-env-vars",
      args: [],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/language-model\/providers$/,
    build: () => ({
      channel: "get-language-model-providers",
      args: [],
      tenantPath: { orgId: "me", workspaceId: "me" },
      requiresAuth: true,
    }),
  },
];

const LEGACY_CHANNELS_ALLOWED_IN_ENFORCE = new Set([
  "get-user-settings",
  "set-user-settings",
  "get-app-version",
  "get-env-vars",
  "get-language-model-providers",
]);

function findRoute(
  routes: RouteDefinition[],
  method: HttpMethod,
  pathName: string,
): RouteDefinition | null {
  return (
    routes.find(
      (item) => item.method === method && item.pattern.test(pathName),
    ) ?? null
  );
}

export function createApiV1Middleware(
  invoke: IpcInvokeHandler,
  options?: {
    resolveRequestContext?: typeof resolveRequestContext;
  },
) {
  const resolveContext =
    options?.resolveRequestContext ?? resolveRequestContext;
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = (req.method || "GET").toUpperCase() as HttpMethod;
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathName = requestUrl.pathname;

    const scopedRoute = findRoute(SCOPED_ROUTES, method, pathName);
    let route: RouteDefinition | null = scopedRoute;
    let isLegacyRoute = false;

    if (!route) {
      route = findRoute(LEGACY_ROUTES, method, pathName);
      isLegacyRoute = Boolean(route);
    }

    if (!route) {
      next();
      return;
    }

    const match = pathName.match(route.pattern);
    if (!match) {
      next();
      return;
    }

    try {
      const body = route.method === "GET" ? {} : await readJsonBody(req);
      const target = route.build(requestUrl, match, body);
      if (!target) {
        writeJson(res, 400, { error: "Invalid route parameters" });
        return;
      }

      if (
        isLegacyRoute &&
        isMultitenantEnforced() &&
        !LEGACY_CHANNELS_ALLOWED_IN_ENFORCE.has(target.channel)
      ) {
        writeJson(res, 410, {
          error:
            "Legacy unscoped endpoint is disabled in MULTITENANT_MODE=enforce",
        });
        return;
      }

      const requestContext = target.requiresAuth
        ? await resolveContext(req, target.tenantPath)
        : null;

      const result = await invoke(target.channel, target.args, {
        requestContext: requestContext ?? undefined,
      });

      if (typeof result === "undefined") {
        res.statusCode = 204;
        res.end();
        return;
      }

      writeJson(res, 200, { data: result });
    } catch (error) {
      if (isHttpError(error)) {
        writeJson(res, error.statusCode, {
          error: error.message,
          code: error.code,
        });
        return;
      }

      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
