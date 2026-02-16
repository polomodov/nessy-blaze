import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createIpcInvokeMiddleware } from "./ipc_http_middleware";

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

  const response = {
    statusCode: 200,
    setHeader: vi.fn((headerName: string, headerValue: string) => {
      headers[headerName.toLowerCase()] = String(headerValue);
    }),
    end: vi.fn((chunk?: string | Buffer) => {
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

describe("createIpcInvokeMiddleware", () => {
  it("skips non-target routes", async () => {
    const invoke = vi.fn();
    const middleware = createIpcInvokeMiddleware(invoke);
    const req = createMockRequest({
      method: "GET",
      url: "/",
    });
    const { response } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payload", async () => {
    const invoke = vi.fn();
    const middleware = createIpcInvokeMiddleware(invoke);
    const req = createMockRequest({
      method: "POST",
      url: "/api/ipc/invoke",
      body: JSON.stringify({ args: [] }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(getBody())).toEqual({
      error: 'Invalid payload: "channel" must be a string',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns 200 with data payload", async () => {
    const invoke = vi.fn().mockResolvedValue({ apps: [] });
    const middleware = createIpcInvokeMiddleware(invoke);
    const req = createMockRequest({
      method: "POST",
      url: "/api/ipc/invoke?foo=bar",
      body: JSON.stringify({
        channel: "list-apps",
        args: [],
      }),
    });
    const { response, headers, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(getBody())).toEqual({
      data: { apps: [] },
    });
    expect(invoke).toHaveBeenCalledWith("list-apps", []);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 204 for undefined handler response", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const middleware = createIpcInvokeMiddleware(invoke);
    const req = createMockRequest({
      method: "POST",
      url: "/api/ipc/invoke",
      body: JSON.stringify({
        channel: "ping",
        args: "not-an-array",
      }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(204);
    expect(getBody()).toBe("");
    expect(invoke).toHaveBeenCalledWith("ping", []);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 when handler throws", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("boom"));
    const middleware = createIpcInvokeMiddleware(invoke);
    const req = createMockRequest({
      method: "POST",
      url: "/api/ipc/invoke",
      body: JSON.stringify({
        channel: "list-apps",
        args: [],
      }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(getBody())).toEqual({
      error: "boom",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
