import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createChatStreamMiddleware } from "./chat_stream_middleware";
import { invokeIpcChannelOverHttp } from "./ipc_http_gateway";

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
    const createResult = (await invokeIpcChannelOverHttp("create-app", [
      { name: `stream-invalid-prompt-${Date.now()}` },
    ])) as {
      chatId: number;
    };

    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: `/api/v1/chats/${createResult.chatId}/stream`,
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

  it("streams chat updates over SSE and persists assistant message", async () => {
    const createResult = (await invokeIpcChannelOverHttp("create-app", [
      { name: `stream-chat-${Date.now()}` },
    ])) as {
      chatId: number;
    };

    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: `/api/v1/chats/${createResult.chatId}/stream`,
      body: JSON.stringify({ prompt: "Build a landing page" }),
    });
    const { response, headers, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("text/event-stream");
    expect(getBody()).toContain("event: chat:response:chunk");
    expect(getBody()).toContain("event: chat:response:end");
    expect(next).not.toHaveBeenCalled();

    const chat = (await invokeIpcChannelOverHttp("get-chat", [
      createResult.chatId,
    ])) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(chat.messages.some((message) => message.role === "assistant")).toBe(
      true,
    );
  });

  it("supports stream cancellation endpoint", async () => {
    const createResult = (await invokeIpcChannelOverHttp("create-app", [
      { name: `stream-cancel-${Date.now()}` },
    ])) as {
      chatId: number;
    };

    const middleware = createChatStreamMiddleware();
    const req = createMockRequest({
      method: "POST",
      url: `/api/v1/chats/${createResult.chatId}/stream/cancel`,
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(204);
    expect(getBody()).toBe("");
    expect(next).not.toHaveBeenCalled();
  });
});
