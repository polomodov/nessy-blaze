import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamParams } from "../ipc/ipc_types";
import { createChatStreamMiddleware } from "./chat_stream_middleware";

const {
  mockHandleChatStreamRequest,
  mockHandleChatCancelRequest,
  mockInitializeDatabase,
} = vi.hoisted(() => ({
  mockHandleChatStreamRequest: vi.fn(),
  mockHandleChatCancelRequest: vi.fn(),
  mockInitializeDatabase: vi.fn(),
}));

vi.mock("../db", () => ({
  initializeDatabase: mockInitializeDatabase,
}));

vi.mock("../ipc/handlers/chat_stream_handlers", () => ({
  handleChatStreamRequest: mockHandleChatStreamRequest,
  handleChatCancelRequest: mockHandleChatCancelRequest,
}));

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
  });

  it("initializes database once when middleware is created", () => {
    createChatStreamMiddleware();
    expect(mockInitializeDatabase).toHaveBeenCalledOnce();
  });

  it("passes through unknown routes", async () => {
    const middleware = createChatStreamMiddleware();
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
    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/chats/22/stream",
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
      async (event: any, request: ChatStreamParams) => {
        event.sender.send("chat:response:chunk", {
          chatId: request.chatId,
          chunk: "hello",
        });
        event.sender.send("chat:response:end", {
          chatId: request.chatId,
          updatedFiles: false,
        });
      },
    );

    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/chats/22/stream",
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

  it("supports stream cancellation endpoint", async () => {
    mockHandleChatCancelRequest.mockResolvedValueOnce(undefined);
    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/chats/23/stream/cancel",
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
});
