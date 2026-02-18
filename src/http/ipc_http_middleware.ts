import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isLegacyIpcHttpInvokeEnabled,
  isMultitenantEnforced,
} from "./feature_flags";
import { isHttpError } from "./http_errors";
import type { RequestContext } from "./request_context";
import { resolveRequestContext } from "./request_context";

export type IpcInvokeHandler = (
  channel: string,
  args: unknown[],
  meta?: {
    requestContext?: RequestContext;
  },
) => Promise<unknown>;

type Next = (error?: unknown) => void;

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

function getPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

export function createIpcInvokeMiddleware(invoke: IpcInvokeHandler) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = req.method?.toUpperCase();
    const pathname = getPathname(req.url || "");

    if (method !== "POST" || pathname !== "/api/ipc/invoke") {
      next();
      return;
    }

    if (!isLegacyIpcHttpInvokeEnabled()) {
      writeJson(res, 410, {
        error:
          "Legacy /api/ipc/invoke endpoint is disabled by IPC_LEGACY_ENABLED=false",
      });
      return;
    }

    try {
      const payload = (await readJsonBody(req)) as {
        channel?: unknown;
        args?: unknown;
      };
      const channel = payload.channel;
      const args = payload.args;

      if (typeof channel !== "string") {
        writeJson(res, 400, {
          error: 'Invalid payload: "channel" must be a string',
        });
        return;
      }

      const invokeArgs = Array.isArray(args) ? args : [];
      const orgIdHintRaw = req.headers["x-blaze-org-id"];
      const workspaceIdHintRaw = req.headers["x-blaze-workspace-id"];
      const orgIdHint =
        typeof orgIdHintRaw === "string"
          ? orgIdHintRaw
          : Array.isArray(orgIdHintRaw)
            ? orgIdHintRaw[0]
            : undefined;
      const workspaceIdHint =
        typeof workspaceIdHintRaw === "string"
          ? workspaceIdHintRaw
          : Array.isArray(workspaceIdHintRaw)
            ? workspaceIdHintRaw[0]
            : undefined;
      const requestContext = isMultitenantEnforced()
        ? await resolveRequestContext(req, {
            orgId: orgIdHint,
            workspaceId: workspaceIdHint,
          })
        : undefined;
      const result = await invoke(channel, invokeArgs, {
        requestContext,
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
