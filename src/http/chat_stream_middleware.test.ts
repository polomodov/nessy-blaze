import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamParams } from "../ipc/ipc_types";
import { createChatStreamMiddleware } from "./chat_stream_middleware";

const {
  mockHandleChatStreamRequest,
  mockHandleChatCancelRequest,
  mockInitializeDatabase,
  mockResolveRequestContext,
  mockEnsureChatInScope,
  mockEnforceAndRecordUsage,
  mockWriteAuditEvent,
} = vi.hoisted(() => ({
  mockHandleChatStreamRequest: vi.fn(),
  mockHandleChatCancelRequest: vi.fn(),
  mockInitializeDatabase: vi.fn(),
  mockResolveRequestContext: vi.fn(),
  mockEnsureChatInScope: vi.fn(),
  mockEnforceAndRecordUsage: vi.fn(),
  mockWriteAuditEvent: vi.fn(),
}));

vi.mock("../db", () => ({
  initializeDatabase: mockInitializeDatabase,
}));

vi.mock("../ipc/handlers/chat_stream_handlers", () => ({
  handleChatStreamRequest: mockHandleChatStreamRequest,
  handleChatCancelRequest: mockHandleChatCancelRequest,
}));

function createMiddleware() {
  return createChatStreamMiddleware({
    loadChatStreamHandlers: async () =>
      ({
        handleChatStreamRequest: mockHandleChatStreamRequest,
        handleChatCancelRequest: mockHandleChatCancelRequest,
      }) as any,
    resolveRequestContext: mockResolveRequestContext,
    ensureChatInScope: mockEnsureChatInScope,
    enforceAndRecordUsage: mockEnforceAndRecordUsage,
    writeAuditEvent: mockWriteAuditEvent,
  });
}

function createMockRequest({
  method,
  url,
  body,
}: {
  method: string;
  url: string;
  body?: string;
}): IncomingMessage {
  const requestStream = Readable.from(body ? [body] : []);
  return Object.assign(requestStream, {
    method,
    url,
    headers: {
      "content-type": "application/json",
    },
  }) as IncomingMessage;
}

function createMockResponse() {
  let responseBody = "";
  const headers: Record<string, string> = {};
  let response: any;

  response = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn((headerName: string, headerValue: string) => {
      headers[headerName.toLowerCase()] = String(headerValue);
    }),
    flushHeaders: vi.fn(() => {
      response.headersSent = true;
    }),
    write: vi.fn((chunk?: string | Buffer) => {
      response.headersSent = true;
      if (typeof chunk === "string") {
        responseBody += chunk;
        return true;
      }
      if (chunk) {
        responseBody += chunk.toString("utf-8");
      }
      return true;
    }),
    end: vi.fn((chunk?: string | Buffer) => {
      response.headersSent = true;
      response.writableEnded = true;
      if (typeof chunk === "string") {
        responseBody += chunk;
        return;
      }
      if (chunk) {
        responseBody += chunk.toString("utf-8");
      }
    }),
  } as unknown as ServerResponse;

  return {
    response,
    headers,
    getBody: () => responseBody,
  };
}

describe("createChatStreamMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRequestContext.mockResolvedValue({
      userId: "user-1",
      externalSub: "dev-user",
      email: "dev@example.com",
      displayName: "Dev",
      orgId: "org-1",
      workspaceId: "ws-1",
      organizationRole: "owner",
      workspaceRole: "owner",
      roles: ["owner"],
      authSource: "dev-bypass",
    });
    mockEnsureChatInScope.mockResolvedValue({
      id: 1,
      appId: 1,
    });
    mockEnforceAndRecordUsage.mockResolvedValue(undefined);
    mockWriteAuditEvent.mockResolvedValue(undefined);
  });

  it("initializes database once when middleware is created", () => {
    createMiddleware();
    expect(mockInitializeDatabase).toHaveBeenCalledOnce();
  });

  it("passes through unknown routes", async () => {
    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "GET",
      url: "/health",
    });
    const { response } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 400 for invalid prompt payload", async () => {
    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/22/stream",
      body: JSON.stringify({ prompt: "" }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(getBody())).toEqual({
      error: 'Invalid payload: "prompt" is required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("streams chat updates over SSE", async () => {
    mockHandleChatStreamRequest.mockImplementationOnce(
      async (eventSink: any, request: ChatStreamParams) => {
        eventSink.send("chat:response:chunk", {
          chatId: request.chatId,
          chunk: "hello",
        });
        eventSink.send("chat:response:end", {
          chatId: request.chatId,
          updatedFiles: false,
        });
      },
    );

    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/22/stream",
      body: JSON.stringify({ prompt: "Build a landing page" }),
    });
    const { response, headers, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("text/event-stream");
    expect(getBody()).toContain("event: chat:response:chunk");
    expect(getBody()).toContain("event: chat:response:end");
    expect(mockHandleChatStreamRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatId: 22,
        prompt: "Build a landing page",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("supports scoped SSE stream route", async () => {
    mockHandleChatStreamRequest.mockImplementationOnce(
      async (eventSink: any, request: ChatStreamParams) => {
        eventSink.send("chat:response:end", {
          chatId: request.chatId,
          updatedFiles: false,
        });
      },
    );

    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/22/stream",
      body: JSON.stringify({ prompt: "Scoped stream" }),
    });
    const { response, headers } = createMockResponse();

    await middleware(req, response, vi.fn());

    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("text/event-stream");
  });

  it("supports stream cancellation endpoint", async () => {
    mockHandleChatCancelRequest.mockResolvedValueOnce(undefined);
    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/23/stream/cancel",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(204);
    expect(getBody()).toBe("");
    expect(mockHandleChatCancelRequest).toHaveBeenCalledWith(
      expect.anything(),
      23,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 410 for legacy unscoped stream route", async () => {
    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/chats/22/stream",
      body: JSON.stringify({ prompt: "Legacy stream should be blocked" }),
    });
    const { response, getBody } = createMockResponse();

    await middleware(req, response, vi.fn());

    expect(response.statusCode).toBe(410);
    expect(JSON.parse(getBody())).toEqual({
      error:
        "Legacy unscoped stream routes are disabled. Use /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream.",
    });
    expect(mockHandleChatStreamRequest).not.toHaveBeenCalled();
  });

  it("returns 410 for legacy unscoped cancel route", async () => {
    const middleware = createMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/chats/23/stream/cancel",
    });
    const { response, getBody } = createMockResponse();

    await middleware(req, response, vi.fn());

    expect(response.statusCode).toBe(410);
    expect(JSON.parse(getBody())).toEqual({
      error:
        "Legacy unscoped stream routes are disabled. Use /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream.",
    });
    expect(mockHandleChatCancelRequest).not.toHaveBeenCalled();
  });
});
