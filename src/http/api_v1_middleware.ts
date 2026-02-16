import type { IncomingMessage, ServerResponse } from "node:http";
import type { IpcInvokeHandler } from "./ipc_http_middleware";

type Next = (error?: unknown) => void;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RouteMatchResult {
  channel: string;
  args: unknown[];
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

const ROUTES: RouteDefinition[] = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/user\/settings$/,
    build: () => ({
      channel: "get-user-settings",
      args: [],
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/user\/settings$/,
    build: (_url, _match, body) => ({
      channel: "set-user-settings",
      args: [body],
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps$/,
    build: () => ({
      channel: "list-apps",
      args: [],
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/apps$/,
    build: (_url, _match, body) => ({
      channel: "create-app",
      args: [body],
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/apps:search$/,
    build: (url) => ({
      channel: "search-app",
      args: [url.searchParams.get("q") ?? ""],
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
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/chats$/,
    build: () => ({
      channel: "get-chats",
      args: [],
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
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/env-vars$/,
    build: () => ({
      channel: "get-env-vars",
      args: [],
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/language-model\/providers$/,
    build: () => ({
      channel: "get-language-model-providers",
      args: [],
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/app\/version$/,
    build: () => ({
      channel: "get-app-version",
      args: [],
    }),
  },
];

export function createApiV1Middleware(invoke: IpcInvokeHandler) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = (req.method || "GET").toUpperCase() as HttpMethod;
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathName = requestUrl.pathname;
    const body = method === "GET" ? {} : await readJsonBody(req);

    const route = ROUTES.find((item) => {
      if (item.method !== method) {
        return false;
      }
      return item.pattern.test(pathName);
    });

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
      const target = route.build(requestUrl, match, body);
      if (!target) {
        writeJson(res, 400, { error: "Invalid route parameters" });
        return;
      }

      const result = await invoke(target.channel, target.args);
      if (typeof result === "undefined") {
        res.statusCode = 204;
        res.end();
        return;
      }

      writeJson(res, 200, { data: result });
    } catch (error) {
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
