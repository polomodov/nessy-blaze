import type { IncomingMessage, ServerResponse } from "node:http";
import { initializeDatabase } from "/src/db/index.ts";
import type { ChatResponseEnd, ChatStreamParams } from "/src/ipc/ipc_types.ts";
import {
  NOOP_SERVER_EVENT_SINK,
  type ServerEventSink,
} from "/src/ipc/utils/server_event_sink.ts";
import { isHttpError } from "/src/http/http_errors.ts";
import {
  enforceAndRecordUsage,
  writeAuditEvent,
} from "/src/http/quota_audit.ts";
import { resolveRequestContext } from "/src/http/request_context.ts";
import { ensureChatInScope } from "/src/http/scoped_repositories.ts";

type Next = (error?: unknown) => void;

const SCOPED_STREAM_ROUTE =
  /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)\/stream$/;
const SCOPED_CANCEL_STREAM_ROUTE =
  /^\/api\/v1\/orgs\/([^/]+)\/workspaces\/([^/]+)\/chats\/(\d+)\/stream\/cancel$/;

const LEGACY_STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream$/;
const LEGACY_CANCEL_STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream\/cancel$/;

const activeHttpEvents = new Map<number, ServerEventSink>();

type ChatStreamHandlerModule =
  typeof import("/src/ipc/handlers/chat_stream_handlers.ts");

export type ChatStreamHandlersLoader = () => Promise<ChatStreamHandlerModule>;

function dynamicImportModule<T>(modulePath: string): Promise<T> {
  return new Function("modulePath", "return import(modulePath);")(
    modulePath,
  ) as Promise<T>;
}

function defaultLoadChatStreamHandlers(): Promise<ChatStreamHandlerModule> {
  return dynamicImportModule<ChatStreamHandlerModule>(
    "/src/ipc/handlers/chat_stream_handlers.ts",
  );
}

interface ChatStreamMiddlewareOptions {
  loadChatStreamHandlers?: ChatStreamHandlersLoader;
  resolveRequestContext?: typeof resolveRequestContext;
  ensureChatInScope?: typeof ensureChatInScope;
  enforceAndRecordUsage?: typeof enforceAndRecordUsage;
  writeAuditEvent?: typeof writeAuditEvent;
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

function createNoopEvent(): ServerEventSink {
  return NOOP_SERVER_EVENT_SINK;
}

function createHttpEvent(
  res: ServerResponse,
  onEnd: (payload: ChatResponseEnd) => void,
): ServerEventSink {
  return {
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
    },
    isClosed: () => res.writableEnded || res.destroyed,
  };
}

function parseRoute(
  method: string | undefined,
  pathName: string,
): {
  isStreamRoute: boolean;
  isCancelRoute: boolean;
  isLegacyRoute: boolean;
  chatId: number | null;
  orgId?: string;
  workspaceId?: string;
} {
  if (method === "POST") {
    const scopedStream = pathName.match(SCOPED_STREAM_ROUTE);
    if (scopedStream) {
      const chatId = Number(scopedStream[3]);
      return {
        isStreamRoute: Number.isFinite(chatId),
        isCancelRoute: false,
        isLegacyRoute: false,
        chatId: Number.isFinite(chatId) ? chatId : null,
        orgId: scopedStream[1],
        workspaceId: scopedStream[2],
      };
    }

    const scopedCancel = pathName.match(SCOPED_CANCEL_STREAM_ROUTE);
    if (scopedCancel) {
      const chatId = Number(scopedCancel[3]);
      return {
        isStreamRoute: false,
        isCancelRoute: Number.isFinite(chatId),
        isLegacyRoute: false,
        chatId: Number.isFinite(chatId) ? chatId : null,
        orgId: scopedCancel[1],
        workspaceId: scopedCancel[2],
      };
    }

    const legacyStream = pathName.match(LEGACY_STREAM_ROUTE);
    if (legacyStream) {
      const chatId = Number(legacyStream[1]);
      return {
        isStreamRoute: Number.isFinite(chatId),
        isCancelRoute: false,
        isLegacyRoute: true,
        chatId: Number.isFinite(chatId) ? chatId : null,
      };
    }

    const legacyCancel = pathName.match(LEGACY_CANCEL_STREAM_ROUTE);
    if (legacyCancel) {
      const chatId = Number(legacyCancel[1]);
      return {
        isStreamRoute: false,
        isCancelRoute: Number.isFinite(chatId),
        isLegacyRoute: true,
        chatId: Number.isFinite(chatId) ? chatId : null,
      };
    }
  }

  return {
    isStreamRoute: false,
    isCancelRoute: false,
    isLegacyRoute: false,
    chatId: null,
  };
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
  const resolveContext =
    options?.resolveRequestContext ?? resolveRequestContext;
  const ensureChatScoped = options?.ensureChatInScope ?? ensureChatInScope;
  const enforceUsage = options?.enforceAndRecordUsage ?? enforceAndRecordUsage;
  const recordAudit = options?.writeAuditEvent ?? writeAuditEvent;

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = req.method?.toUpperCase();
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathName = requestUrl.pathname;

    const routeState = parseRoute(method, pathName);
    if (
      !routeState.isStreamRoute &&
      !routeState.isCancelRoute &&
      !routeState.isLegacyRoute
    ) {
      next();
      return;
    }

    if (routeState.isLegacyRoute) {
      writeJson(res, 410, {
        error:
          "Legacy unscoped stream routes are disabled. Use /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream.",
      });
      return;
    }

    if (routeState.chatId == null) {
      writeJson(res, 400, { error: "Invalid chatId in path" });
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

    try {
      const requestContext = await resolveContext(req, {
        orgId: routeState.orgId ?? "me",
        workspaceId: routeState.workspaceId ?? "me",
      });

      await ensureChatScoped(requestContext, routeState.chatId);

      if (routeState.isCancelRoute) {
        try {
          const { handleChatCancelRequest } = await loadChatStreamHandlers();
          const event =
            activeHttpEvents.get(routeState.chatId) ?? createNoopEvent();
          await handleChatCancelRequest(event, routeState.chatId);
          await recordAudit({
            context: requestContext,
            action: "chat_stream_cancel",
            resourceType: "chat",
            resourceId: routeState.chatId,
            metadata: { transport: "sse" },
          });
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
          return;
        }

        res.statusCode = 204;
        res.end();
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

      await enforceUsage({
        context: requestContext,
        metricType: "requests",
        value: 1,
      });

      const streamRequest: ChatStreamParams = {
        chatId: routeState.chatId,
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
        activeHttpEvents.delete(routeState.chatId!);
        if (!res.writableEnded && !res.destroyed) {
          if (!payload || typeof payload.chatId !== "number") {
            writeSseEvent(res, "chat:response:end", {
              chatId: routeState.chatId!,
              updatedFiles: false,
            } satisfies ChatResponseEnd);
          }
          res.end();
        }

        if (
          typeof payload?.totalTokens === "number" &&
          payload.totalTokens > 0
        ) {
          void enforceUsage({
            context: requestContext,
            metricType: "tokens",
            value: payload.totalTokens,
          }).catch((error) => {
            console.error(
              "[chat_stream_middleware] token usage record failed",
              error,
            );
          });
        }

        void recordAudit({
          context: requestContext,
          action: "chat_stream_end",
          resourceType: "chat",
          resourceId: routeState.chatId,
          metadata: {
            transport: "sse",
            updatedFiles: Boolean(payload?.updatedFiles),
            totalTokens:
              typeof payload?.totalTokens === "number"
                ? payload.totalTokens
                : null,
          },
        });
      };

      const event = createHttpEvent(res, onStreamEnd);
      activeHttpEvents.set(routeState.chatId, event);

      let handleChatCancelRequest:
        | ((eventSink: ServerEventSink, chatId: number) => Promise<unknown>)
        | null = null;
      let handleChatStreamRequest:
        | ((
            eventSink: ServerEventSink,
            req: ChatStreamParams,
          ) => Promise<unknown>)
        | null = null;

      try {
        const handlers = await loadChatStreamHandlers();
        handleChatCancelRequest = handlers.handleChatCancelRequest;
        handleChatStreamRequest = handlers.handleChatStreamRequest;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        writeSseEvent(res, "chat:response:error", {
          chatId: routeState.chatId,
          error: errorMessage,
        });
        writeSseEvent(res, "chat:response:end", {
          chatId: routeState.chatId,
          updatedFiles: false,
        });
        res.end();
        activeHttpEvents.delete(routeState.chatId);
        return;
      }

      req.on("close", () => {
        if (streamEnded) {
          return;
        }
        if (handleChatCancelRequest) {
          void handleChatCancelRequest(event, routeState.chatId!);
        }
        activeHttpEvents.delete(routeState.chatId!);
      });

      await recordAudit({
        context: requestContext,
        action: "chat_stream_start",
        resourceType: "chat",
        resourceId: routeState.chatId,
        metadata: { transport: "sse", promptLength: prompt.length },
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
          chatId: routeState.chatId,
          error: errorMessage,
        });
      } finally {
        if (!streamEnded && !res.writableEnded && !res.destroyed) {
          writeSseEvent(res, "chat:response:end", {
            chatId: routeState.chatId,
            updatedFiles: false,
          });
          res.end();
        }
        activeHttpEvents.delete(routeState.chatId!);
      }
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
