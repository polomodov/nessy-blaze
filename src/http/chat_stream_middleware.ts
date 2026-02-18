import type { IncomingMessage, ServerResponse } from "node:http";
import type { IpcMainInvokeEvent } from "electron";
import { initializeDatabase } from "../db";
import type { ChatResponseEnd, ChatStreamParams } from "../ipc/ipc_types";
import { resolveConsent } from "../ipc/utils/mcp_consent";
import { resolveAgentToolConsent } from "../pro/main/ipc/handlers/local_agent/agent_tool_consent";

type Next = (error?: unknown) => void;

const STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream$/;
const CANCEL_STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream\/cancel$/;
const activeHttpEvents = new Map<number, IpcMainInvokeEvent>();

type ChatStreamHandlerModule =
  typeof import("../ipc/handlers/chat_stream_handlers");

export type ChatStreamHandlersLoader = () => Promise<ChatStreamHandlerModule>;

function dynamicImportModule<T>(modulePath: string): Promise<T> {
  return new Function("modulePath", "return import(modulePath);")(
    modulePath,
  ) as Promise<T>;
}

function defaultLoadChatStreamHandlers(): Promise<ChatStreamHandlerModule> {
  return dynamicImportModule<ChatStreamHandlerModule>(
    "../ipc/handlers/chat_stream_handlers",
  );
}

interface ChatStreamMiddlewareOptions {
  loadChatStreamHandlers?: ChatStreamHandlersLoader;
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

function writeSseEvent(
  res: ServerResponse,
  event: "chat:response:chunk" | "chat:response:end" | "chat:response:error",
  payload: unknown,
) {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function resolveChatId(pathName: string, route: RegExp): number | null {
  const match = pathName.match(route);
  if (!match) {
    return null;
  }

  const chatId = Number(match[1]);
  if (!Number.isFinite(chatId)) {
    return null;
  }

  return chatId;
}

function createNoopEvent(): IpcMainInvokeEvent {
  return {
    sender: {
      send: () => {},
      isDestroyed: () => false,
      isCrashed: () => false,
    } as any,
  } as IpcMainInvokeEvent;
}

function createHttpEvent(
  res: ServerResponse,
  onEnd: (payload: ChatResponseEnd) => void,
): IpcMainInvokeEvent {
  return {
    sender: {
      send: (channel: string, ...args: unknown[]) => {
        const payload = args[0];
        if (
          channel === "chat:response:chunk" ||
          channel === "chat:response:error" ||
          channel === "chat:response:end"
        ) {
          writeSseEvent(
            res,
            channel as
              | "chat:response:chunk"
              | "chat:response:error"
              | "chat:response:end",
            payload,
          );

          if (channel === "chat:response:end") {
            onEnd(
              (payload as ChatResponseEnd) ?? {
                chatId: 0,
                updatedFiles: false,
              },
            );
          }
          return;
        }

        if (
          channel === "mcp:tool-consent-request" &&
          payload &&
          typeof payload === "object" &&
          "requestId" in (payload as Record<string, unknown>)
        ) {
          const requestId = String(
            (payload as Record<string, unknown>).requestId ?? "",
          );
          if (requestId) {
            resolveConsent(requestId, "decline");
          }
          return;
        }

        if (
          channel === "agent-tool:consent-request" &&
          payload &&
          typeof payload === "object" &&
          "requestId" in (payload as Record<string, unknown>)
        ) {
          const requestId = String(
            (payload as Record<string, unknown>).requestId ?? "",
          );
          if (requestId) {
            resolveAgentToolConsent(requestId, "decline");
          }
        }
      },
      isDestroyed: () => false,
      isCrashed: () => false,
    } as any,
  } as IpcMainInvokeEvent;
}

export function createChatStreamMiddleware(
  options?: ChatStreamMiddlewareOptions,
) {
  // Shared chat streaming logic depends on the drizzle database connection.
  void Promise.resolve(initializeDatabase()).catch((error) => {
    console.error(
      "[chat_stream_middleware] Failed to initialize database",
      error,
    );
  });
  const loadChatStreamHandlers =
    options?.loadChatStreamHandlers ?? defaultLoadChatStreamHandlers;

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = req.method?.toUpperCase();
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathName = requestUrl.pathname;

    const isStreamRoute = method === "POST" && STREAM_ROUTE.test(pathName);
    const isCancelRoute =
      method === "POST" && CANCEL_STREAM_ROUTE.test(pathName);

    if (!isStreamRoute && !isCancelRoute) {
      next();
      return;
    }

    try {
      await initializeDatabase();
    } catch (error) {
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (isCancelRoute) {
      const chatId = resolveChatId(pathName, CANCEL_STREAM_ROUTE);
      if (chatId == null) {
        writeJson(res, 400, { error: "Invalid chatId in path" });
        return;
      }

      try {
        const { handleChatCancelRequest } = await loadChatStreamHandlers();
        const event = activeHttpEvents.get(chatId) ?? createNoopEvent();
        await handleChatCancelRequest(event, chatId);
      } catch (error) {
        writeJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      res.statusCode = 204;
      res.end();
      return;
    }

    const chatId = resolveChatId(pathName, STREAM_ROUTE);
    if (chatId == null) {
      writeJson(res, 400, { error: "Invalid chatId in path" });
      return;
    }

    let payload: Partial<ChatStreamParams>;
    try {
      payload = (await readJsonBody(req)) as Partial<ChatStreamParams>;
    } catch {
      writeJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const prompt =
      typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      writeJson(res, 400, { error: 'Invalid payload: "prompt" is required' });
      return;
    }

    const streamRequest: ChatStreamParams = {
      chatId,
      prompt,
      redo: payload.redo === true ? true : undefined,
      attachments: Array.isArray(payload.attachments)
        ? (payload.attachments as ChatStreamParams["attachments"])
        : undefined,
      selectedComponents: Array.isArray(payload.selectedComponents)
        ? (payload.selectedComponents as ChatStreamParams["selectedComponents"])
        : undefined,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    let streamEnded = false;
    const onStreamEnd = (payload: ChatResponseEnd) => {
      if (streamEnded) {
        return;
      }
      streamEnded = true;
      activeHttpEvents.delete(chatId);
      if (!res.writableEnded && !res.destroyed) {
        if (!payload || typeof payload.chatId !== "number") {
          writeSseEvent(res, "chat:response:end", {
            chatId,
            updatedFiles: false,
          } satisfies ChatResponseEnd);
        }
        res.end();
      }
    };

    const event = createHttpEvent(res, onStreamEnd);
    activeHttpEvents.set(chatId, event);

    let handleChatCancelRequest:
      | ((event: IpcMainInvokeEvent, chatId: number) => Promise<unknown>)
      | null = null;
    let handleChatStreamRequest:
      | ((event: IpcMainInvokeEvent, req: ChatStreamParams) => Promise<unknown>)
      | null = null;

    try {
      const handlers = await loadChatStreamHandlers();
      handleChatCancelRequest = handlers.handleChatCancelRequest;
      handleChatStreamRequest = handlers.handleChatStreamRequest;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      writeSseEvent(res, "chat:response:error", {
        chatId,
        error: errorMessage,
      });
      writeSseEvent(res, "chat:response:end", {
        chatId,
        updatedFiles: false,
      });
      res.end();
      activeHttpEvents.delete(chatId);
      return;
    }

    req.on("close", () => {
      if (streamEnded) {
        return;
      }
      if (handleChatCancelRequest) {
        void handleChatCancelRequest(event, chatId);
      }
      activeHttpEvents.delete(chatId);
    });

    try {
      if (!handleChatStreamRequest) {
        throw new Error("chat stream handlers are not initialized");
      }
      await handleChatStreamRequest(event, streamRequest);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      writeSseEvent(res, "chat:response:error", {
        chatId,
        error: errorMessage,
      });
    } finally {
      if (!streamEnded && !res.writableEnded && !res.destroyed) {
        writeSseEvent(res, "chat:response:end", {
          chatId,
          updatedFiles: false,
        });
        res.end();
      }
      activeHttpEvents.delete(chatId);
    }
  };
}
