import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { initializeDatabase } from "/src/db/index.ts";
import type { ChatResponseEnd, ChatStreamParams } from "/src/ipc/ipc_types.ts";
import type { ServerEventSink } from "/src/ipc/utils/server_event_sink.ts";
import { isWebSocketStreamingEnabled } from "/src/http/feature_flags.ts";
import { isHttpError } from "/src/http/http_errors.ts";
import {
  enforceAndRecordUsage,
  writeAuditEvent,
} from "/src/http/quota_audit.ts";
import type { RequestContext } from "/src/http/request_context.ts";
import { resolveRequestContext } from "/src/http/request_context.ts";
import { ensureChatInScope } from "/src/http/scoped_repositories.ts";
import {
  createWsServerEvent,
  parseWsClientMessage,
  type WsCancelChatStreamMessage,
  type WsStartChatStreamMessage,
} from "/src/http/chat_ws_adapter.ts";
import { createChatStreamStableEmitter } from "/src/http/chat_stream_core.ts";

type ChatStreamHandlerModule =
  typeof import("/src/ipc/handlers/chat_stream_handlers.ts");

export type ChatStreamHandlersLoader = () => Promise<ChatStreamHandlerModule>;

interface ChatStreamHandlers {
  handleChatStreamRequest: (
    eventSink: ServerEventSink,
    req: ChatStreamParams,
  ) => Promise<unknown>;
  handleChatCancelRequest: (
    eventSink: ServerEventSink,
    chatId: number,
  ) => Promise<unknown>;
}

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

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  statusText: string,
  message: string,
) {
  const body = JSON.stringify({ error: message });
  const response = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");

  socket.write(response);
  socket.destroy();
}

interface ActiveStream {
  requestId: string;
  chatId: number;
  context: RequestContext;
  eventSink: ServerEventSink;
  ended: boolean;
}

interface ChatWsSessionOptions {
  req: IncomingMessage;
  send: (payload: string) => void;
  isOpen: () => boolean;
  loadChatStreamHandlers?: ChatStreamHandlersLoader;
  resolveRequestContext?: typeof resolveRequestContext;
  ensureChatInScope?: typeof ensureChatInScope;
  enforceAndRecordUsage?: typeof enforceAndRecordUsage;
  writeAuditEvent?: typeof writeAuditEvent;
}

export interface ChatWsSession {
  handleRawMessage: (raw: RawData) => Promise<void>;
  handleClose: () => Promise<void>;
}

export function createChatWsSession(
  options: ChatWsSessionOptions,
): ChatWsSession {
  const loadHandlers =
    options.loadChatStreamHandlers ?? defaultLoadChatStreamHandlers;
  const resolveContext = options.resolveRequestContext ?? resolveRequestContext;
  const ensureChatScoped = options.ensureChatInScope ?? ensureChatInScope;
  const enforceUsage = options.enforceAndRecordUsage ?? enforceAndRecordUsage;
  const recordAudit = options.writeAuditEvent ?? writeAuditEvent;

  let handlersPromise: Promise<ChatStreamHandlers> | null = null;

  const activeByRequestId = new Map<string, ActiveStream>();
  const activeByChatId = new Map<number, ActiveStream>();

  const sendEvent = (params: {
    event: "chat:response:chunk" | "chat:response:error" | "chat:response:end";
    requestId?: string;
    payload: unknown;
  }) => {
    if (!options.isOpen()) {
      return;
    }
    options.send(
      createWsServerEvent({
        event: params.event,
        requestId: params.requestId,
        payload: params.payload,
      }),
    );
  };

  const sendError = (
    message: string,
    params?: { requestId?: string; chatId?: number },
  ) => {
    sendEvent({
      event: "chat:response:error",
      requestId: params?.requestId,
      payload: {
        chatId: params?.chatId,
        error: message,
      },
    });
  };

  const getHandlers = async (): Promise<ChatStreamHandlers> => {
    if (!handlersPromise) {
      handlersPromise = loadHandlers().then((module) => ({
        handleChatStreamRequest: module.handleChatStreamRequest,
        handleChatCancelRequest: module.handleChatCancelRequest,
      }));
    }
    return handlersPromise;
  };

  const cleanupActive = (active: ActiveStream) => {
    const byRequest = activeByRequestId.get(active.requestId);
    if (byRequest === active) {
      activeByRequestId.delete(active.requestId);
    }
    const byChat = activeByChatId.get(active.chatId);
    if (byChat === active) {
      activeByChatId.delete(active.chatId);
    }
  };

  const resolveScopedContext = async (
    orgId: string,
    workspaceId: string,
  ): Promise<RequestContext> => {
    return resolveContext(options.req, {
      orgId,
      workspaceId,
    });
  };

  const createWsEventSink = (params: {
    requestId: string;
    chatId: number;
    onEnd: (payload: ChatResponseEnd) => void;
  }): ServerEventSink => {
    const stableEmitter = createChatStreamStableEmitter({
      chatId: params.chatId,
      onEvent: (event) => {
        sendEvent({
          event: event.event,
          requestId: params.requestId,
          payload: event.payload,
        });
        if (event.event === "chat:response:end") {
          params.onEnd(
            (event.payload as ChatResponseEnd) ?? {
              chatId: params.chatId,
              updatedFiles: false,
            },
          );
        }
      },
    });

    return {
      send: (channel: string, ...args: unknown[]) => {
        const payload = args[0];

        if (channel === "chat:response:chunk") {
          stableEmitter.emitChunk(payload);
          return;
        }

        if (channel === "chat:response:error") {
          stableEmitter.emitError(payload);
          return;
        }

        if (channel === "chat:response:end") {
          stableEmitter.emitEnd(
            (payload as ChatResponseEnd) ?? {
              chatId: params.chatId,
              updatedFiles: false,
            },
          );
          return;
        }
      },
      isClosed: () => !options.isOpen() || stableEmitter.isEnded(),
    };
  };

  const handleStart = async (message: WsStartChatStreamMessage) => {
    if (activeByRequestId.has(message.requestId)) {
      sendError("Duplicate requestId", {
        requestId: message.requestId,
        chatId: message.chatId,
      });
      return;
    }

    if (activeByChatId.has(message.chatId)) {
      sendError("Chat stream already active", {
        requestId: message.requestId,
        chatId: message.chatId,
      });
      return;
    }

    const requestContext = await resolveScopedContext(
      message.orgId,
      message.workspaceId,
    );
    await ensureChatScoped(requestContext, message.chatId);

    await enforceUsage({
      context: requestContext,
      metricType: "requests",
      value: 1,
    });

    const active: ActiveStream = {
      requestId: message.requestId,
      chatId: message.chatId,
      context: requestContext,
      ended: false,
      eventSink: {
        send() {},
        isClosed: () => true,
      },
    };

    const onEnd = (payload: ChatResponseEnd) => {
      if (active.ended) {
        return;
      }
      active.ended = true;
      cleanupActive(active);

      if (typeof payload.totalTokens === "number" && payload.totalTokens > 0) {
        void enforceUsage({
          context: requestContext,
          metricType: "tokens",
          value: payload.totalTokens,
        }).catch((error) => {
          console.error("[chat_ws_server] token usage record failed", error);
        });
      }

      void recordAudit({
        context: requestContext,
        action: "chat_stream_end",
        resourceType: "chat",
        resourceId: message.chatId,
        metadata: {
          transport: "websocket",
          requestId: message.requestId,
          updatedFiles: Boolean(payload.updatedFiles),
          totalTokens:
            typeof payload.totalTokens === "number"
              ? payload.totalTokens
              : null,
        },
      });
    };

    active.eventSink = createWsEventSink({
      requestId: message.requestId,
      chatId: message.chatId,
      onEnd,
    });

    activeByRequestId.set(message.requestId, active);
    activeByChatId.set(message.chatId, active);

    await recordAudit({
      context: requestContext,
      action: "chat_stream_start",
      resourceType: "chat",
      resourceId: message.chatId,
      metadata: {
        transport: "websocket",
        requestId: message.requestId,
        promptLength: message.prompt.length,
      },
    });

    const handlers = await getHandlers();

    const streamRequest: ChatStreamParams = {
      chatId: message.chatId,
      prompt: message.prompt,
      redo: message.redo === true ? true : undefined,
      attachments: message.attachments,
      selectedComponents: message.selectedComponents,
    };

    try {
      await handlers.handleChatStreamRequest(active.eventSink, streamRequest);
    } catch (error) {
      sendError(serializeError(error), {
        requestId: message.requestId,
        chatId: message.chatId,
      });
    } finally {
      if (
        !active.ended &&
        activeByRequestId.get(message.requestId) === active
      ) {
        sendEvent({
          event: "chat:response:end",
          requestId: message.requestId,
          payload: {
            chatId: message.chatId,
            updatedFiles: false,
          } satisfies ChatResponseEnd,
        });
        onEnd({ chatId: message.chatId, updatedFiles: false });
      }
    }
  };

  const handleCancel = async (message: WsCancelChatStreamMessage) => {
    const target = message.requestId
      ? activeByRequestId.get(message.requestId)
      : message.chatId != null
        ? activeByChatId.get(message.chatId)
        : undefined;

    if (!target) {
      sendError("No active stream found", {
        requestId: message.requestId,
        chatId: message.chatId,
      });
      return;
    }

    await ensureChatScoped(target.context, target.chatId);
    const handlers = await getHandlers();
    await handlers.handleChatCancelRequest(target.eventSink, target.chatId);

    await recordAudit({
      context: target.context,
      action: "chat_stream_cancel",
      resourceType: "chat",
      resourceId: target.chatId,
      metadata: {
        transport: "websocket",
        requestId: target.requestId,
      },
    });

    cleanupActive(target);
  };

  return {
    async handleRawMessage(raw: RawData) {
      let textPayload = "";
      if (typeof raw === "string") {
        textPayload = raw;
      } else if (raw instanceof Buffer) {
        textPayload = raw.toString("utf8");
      } else if (Array.isArray(raw)) {
        textPayload = Buffer.concat(raw).toString("utf8");
      } else {
        textPayload = Buffer.from(raw as ArrayBuffer).toString("utf8");
      }

      let parsed;
      try {
        parsed = parseWsClientMessage(textPayload);
      } catch (error) {
        sendError(serializeError(error));
        return;
      }

      try {
        if (parsed.type === "start_chat_stream") {
          await handleStart(parsed);
          return;
        }

        await handleCancel(parsed);
      } catch (error) {
        const requestId = parsed.requestId;
        if (isHttpError(error)) {
          sendError(error.message, {
            requestId,
            chatId: parsed.chatId,
          });
          return;
        }
        sendError(serializeError(error), {
          requestId,
          chatId: parsed.chatId,
        });
      }
    },

    async handleClose() {
      const current = Array.from(activeByRequestId.values());
      if (current.length === 0) {
        return;
      }
      const handlers = await getHandlers();
      await Promise.all(
        current.map(async (active) => {
          try {
            await handlers.handleChatCancelRequest(
              active.eventSink,
              active.chatId,
            );
          } catch {
            // Ignore close-time cancellation errors.
          } finally {
            cleanupActive(active);
          }
        }),
      );
    },
  };
}

interface AttachChatWsServerOptions {
  httpServer: HttpServer;
  path?: string;
  loadChatStreamHandlers?: ChatStreamHandlersLoader;
  resolveRequestContext?: typeof resolveRequestContext;
  ensureChatInScope?: typeof ensureChatInScope;
  enforceAndRecordUsage?: typeof enforceAndRecordUsage;
  writeAuditEvent?: typeof writeAuditEvent;
}

export interface ChatWsServerHandle {
  dispose: () => void;
}

export function attachChatWsServer(
  options: AttachChatWsServerOptions,
): ChatWsServerHandle {
  if (!isWebSocketStreamingEnabled()) {
    return {
      dispose: () => {},
    };
  }

  const wsPath = options.path ?? "/api/v1/ws";
  const wss = new WebSocketServer({ noServer: true });

  const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
    const session = createChatWsSession({
      req,
      send: (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      },
      isOpen: () => ws.readyState === WebSocket.OPEN,
      loadChatStreamHandlers: options.loadChatStreamHandlers,
      resolveRequestContext: options.resolveRequestContext,
      ensureChatInScope: options.ensureChatInScope,
      enforceAndRecordUsage: options.enforceAndRecordUsage,
      writeAuditEvent: options.writeAuditEvent,
    });

    ws.on("message", (raw: RawData) => {
      void session.handleRawMessage(raw);
    });

    ws.on("close", () => {
      void session.handleClose();
    });
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    if (requestUrl.pathname !== wsPath) {
      return;
    }

    void (async () => {
      try {
        await initializeDatabase();
        await (options.resolveRequestContext ?? resolveRequestContext)(req, {
          orgId: "me",
          workspaceId: "me",
        });
      } catch (error) {
        const statusCode = isHttpError(error) ? error.statusCode : 401;
        const message = isHttpError(error)
          ? error.message
          : "Unauthorized WebSocket upgrade";
        rejectUpgrade(socket, statusCode, "Unauthorized", message);
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        handleConnection(ws, req);
      });
    })();
  };

  options.httpServer.on("upgrade", onUpgrade);

  return {
    dispose: () => {
      options.httpServer.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}
