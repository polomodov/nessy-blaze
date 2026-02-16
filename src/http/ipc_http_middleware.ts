import type { IncomingMessage, ServerResponse } from "node:http";

export type IpcInvokeHandler = (
  channel: string,
  args: unknown[],
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
      const result = await invoke(channel, invokeArgs);

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
