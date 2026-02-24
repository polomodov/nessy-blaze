import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, isHttpError } from "/src/http/http_errors.ts";
import { resolveRequestContext } from "/src/http/request_context.ts";

type Next = (error?: unknown) => void;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type IpcInvokeHandler = (
  channel: string,
  args: unknown[],
  meta?: {
    requestContext?: unknown;
  },
) => Promise<unknown>;

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

function parseRecordBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function parseRestartAppPayload(body: unknown): {
  removeNodeModules?: boolean;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["removeNodeModules"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (
    "removeNodeModules" in payload &&
    typeof payload.removeNodeModules !== "boolean"
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "removeNodeModules" must be a boolean',
    );
  }

  return typeof payload.removeNodeModules === "boolean"
    ? { removeNodeModules: payload.removeNodeModules }
    : {};
}

function parseProposalActionPayload(body: unknown): {
  messageId: number;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["messageId"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (
    typeof payload.messageId !== "number" ||
    !Number.isFinite(payload.messageId)
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "messageId" must be a finite number',
    );
  }

  return { messageId: payload.messageId };
}

function parseCheckoutVersionPayload(body: unknown): {
  versionId: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["versionId"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (typeof payload.versionId !== "string" || payload.versionId.length === 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "versionId" must be a non-empty string',
    );
  }

  return { versionId: payload.versionId };
}

function parseRevertVersionPayload(body: unknown): {
  previousVersionId: string;
  currentChatMessageId?: { chatId: number; messageId: number };
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["previousVersionId", "currentChatMessageId"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (
    typeof payload.previousVersionId !== "string" ||
    payload.previousVersionId.length === 0
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "previousVersionId" must be a non-empty string',
    );
  }

  if (payload.currentChatMessageId === undefined) {
    return { previousVersionId: payload.previousVersionId };
  }

  if (
    !payload.currentChatMessageId ||
    typeof payload.currentChatMessageId !== "object" ||
    Array.isArray(payload.currentChatMessageId)
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "currentChatMessageId" must be an object',
    );
  }

  const messagePayload = payload.currentChatMessageId as Record<
    string,
    unknown
  >;
  const nestedAllowedKeys = new Set(["chatId", "messageId"]);
  const nestedUnsupportedKeys = Object.keys(messagePayload).filter(
    (key) => !nestedAllowedKeys.has(key),
  );
  if (nestedUnsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported currentChatMessageId keys (${nestedUnsupportedKeys.join(
        ", ",
      )})`,
    );
  }

  if (
    typeof messagePayload.chatId !== "number" ||
    !Number.isFinite(messagePayload.chatId)
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "currentChatMessageId.chatId" must be a finite number',
    );
  }

  if (
    typeof messagePayload.messageId !== "number" ||
    !Number.isFinite(messagePayload.messageId)
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "currentChatMessageId.messageId" must be a finite number',
    );
  }

  return {
    previousVersionId: payload.previousVersionId,
    currentChatMessageId: {
      chatId: messagePayload.chatId,
      messageId: messagePayload.messageId,
    },
  };
}

function parseUpdateChatPayload(body: unknown): {
  title?: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["title"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if ("title" in payload && typeof payload.title !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "title" must be a string',
    );
  }

  return typeof payload.title === "string" ? { title: payload.title } : {};
}

function parseCreateAppPayload(body: unknown): {
  name: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a non-empty string',
    );
  }

  return { name: payload.name };
}

function parsePatchAppPayload(body: unknown): {
  name?: string;
  isFavorite?: boolean;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name", "isFavorite"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if ("name" in payload && typeof payload.name !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a string',
    );
  }

  if ("isFavorite" in payload && typeof payload.isFavorite !== "boolean") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "isFavorite" must be a boolean',
    );
  }

  const normalized: { name?: string; isFavorite?: boolean } = {};
  if (typeof payload.name === "string") {
    normalized.name = payload.name;
  }
  if (typeof payload.isFavorite === "boolean") {
    normalized.isFavorite = payload.isFavorite;
  }
  return normalized;
}

function parseCreateOrgPayload(body: unknown): {
  name?: string;
  slug?: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name", "slug"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if ("name" in payload && typeof payload.name !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a string',
    );
  }

  if ("slug" in payload && typeof payload.slug !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "slug" must be a string',
    );
  }

  const normalized: { name?: string; slug?: string } = {};
  if (typeof payload.name === "string") {
    normalized.name = payload.name;
  }
  if (typeof payload.slug === "string") {
    normalized.slug = payload.slug;
  }
  return normalized;
}

function parsePatchOrgPayload(body: unknown): {
  name: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a non-empty string',
    );
  }

  return { name: payload.name };
}

function parseCreateWorkspacePayload(body: unknown): {
  name: string;
  slug?: string;
  type?: "personal" | "team";
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name", "slug", "type"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a non-empty string',
    );
  }

  if ("slug" in payload && typeof payload.slug !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "slug" must be a string',
    );
  }

  if (
    "type" in payload &&
    payload.type !== "personal" &&
    payload.type !== "team"
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "type" must be "personal" or "team"',
    );
  }

  const normalized: {
    name: string;
    slug?: string;
    type?: "personal" | "team";
  } = {
    name: payload.name,
  };
  if (typeof payload.slug === "string") {
    normalized.slug = payload.slug;
  }
  if (payload.type === "personal" || payload.type === "team") {
    normalized.type = payload.type;
  }
  return normalized;
}

function parsePatchWorkspacePayload(body: unknown): {
  name?: string;
  slug?: string;
} {
  const payload = parseRecordBody(body);
  const allowedKeys = new Set(["name", "slug"]);
  const unsupportedKeys = Object.keys(payload).filter(
    (key) => !allowedKeys.has(key),
  );

  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Invalid payload: unsupported keys (${unsupportedKeys.join(", ")})`,
    );
  }

  if ("name" in payload && typeof payload.name !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "name" must be a string',
    );
  }

  if ("slug" in payload && typeof payload.slug !== "string") {
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      'Invalid payload: "slug" must be a string',
    );
  }

  const normalized: { name?: string; slug?: string } = {};
  if (typeof payload.name === "string") {
    normalized.name = payload.name;
  }
  if (typeof payload.slug === "string") {
    normalized.slug = payload.slug;
  }
  return normalized;
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
    build: (_url, _match, body) => {
      const payload = parseCreateOrgPayload(body);
      return {
        channel: "create-org",
        args: [payload],
        requiresAuth: true,
      };
    },
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
    build: (_url, match, body) => {
      const payload = parsePatchOrgPayload(body);
      return {
        channel: "patch-org",
        args: [payload],
        tenantPath: { orgId: match[1] },
        requiresAuth: true,
      };
    },
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
    build: (_url, match, body) => {
      const payload = parseCreateWorkspacePayload(body);
      return {
        channel: "create-workspace",
        args: [payload],
        tenantPath: { orgId: match[1] },
        requiresAuth: true,
      };
    },
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
    build: (_url, match, body) => {
      const payload = parsePatchWorkspacePayload(body);
      return {
        channel: "patch-workspace",
        args: [payload],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
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
    build: (_url, match, body) => {
      const payload = parseCreateAppPayload(body);
      return {
        channel: "create-app",
        args: [payload],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
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
    method: "GET",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/file$/,
    build: (url, match) => {
      const appId = parseNumber(match[3]);
      const filePath = url.searchParams.get("path");
      if (appId == null || !filePath) {
        return null;
      }
      return {
        channel: "read-app-file",
        args: [{ appId, filePath }],
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
      const payload = parsePatchAppPayload(body);
      return {
        channel: "patch-app",
        args: [appId, payload],
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
      const payload = parseRestartAppPayload(body);
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
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/versions$/,
    build: (_url, match) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      return {
        channel: "list-versions",
        args: [{ appId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/versions\/checkout$/,
    build: (_url, match, body) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      const payload = parseCheckoutVersionPayload(body);
      return {
        channel: "checkout-version",
        args: [{ appId, ...payload }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/(\d+)\/versions\/revert$/,
    build: (_url, match, body) => {
      const appId = parseNumber(match[3]);
      if (appId == null) {
        return null;
      }
      const payload = parseRevertVersionPayload(body);
      return {
        channel: "revert-version",
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
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)\/proposal$/,
    build: (_url, match) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      return {
        channel: "get-proposal",
        args: [{ chatId }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)\/proposal\/approve$/,
    build: (_url, match, body) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      const payload = parseProposalActionPayload(body);
      return {
        channel: "approve-proposal",
        args: [{ chatId, ...payload }],
        tenantPath: { orgId: match[1], workspaceId: match[2] },
        requiresAuth: true,
      };
    },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)\/proposal\/reject$/,
    build: (_url, match, body) => {
      const chatId = parseNumber(match[3]);
      if (chatId == null) {
        return null;
      }
      const payload = parseProposalActionPayload(body);
      return {
        channel: "reject-proposal",
        args: [{ chatId, ...payload }],
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
      const payload = parseUpdateChatPayload(body);
      return {
        channel: "update-chat",
        args: [{ chatId, ...payload }],
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
    pattern: /^\/api\/v1\/settings\/user$/,
    build: () => ({
      channel: "get-user-settings",
      args: [],
      requiresAuth: true,
    }),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/settings\/user$/,
    build: (_url, _match, body) => ({
      channel: "set-user-settings",
      args: [body],
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/env-vars$/,
    build: () => ({
      channel: "get-env-vars",
      args: [],
      requiresAuth: true,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/auth\/oauth\/config$/,
    build: () => ({
      channel: "get-oauth2-config",
      args: [],
      requiresAuth: false,
    }),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/auth\/oauth\/exchange$/,
    build: (_url, _match, body) => ({
      channel: "exchange-oauth2-code",
      args: [body],
      requiresAuth: false,
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

    const route = findRoute(SCOPED_ROUTES, method, pathName);

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
