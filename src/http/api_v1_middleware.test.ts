import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createApiV1Middleware } from "./api_v1_middleware";
import type { RequestContext } from "./request_context";

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

describe("createApiV1Middleware", () => {
  const requestContext: RequestContext = {
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
  };

  const resolveRequestContextMock = vi.fn().mockResolvedValue(requestContext);

  it("routes GET /api/v1/orgs/:orgId/workspaces/:workspaceId/apps to list-apps channel", async () => {
    const invoke = vi.fn().mockResolvedValue({ apps: [] });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps",
    });
    const { response, headers, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("list-apps", [], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(getBody())).toEqual({ data: { apps: [] } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes PATCH /api/v1/settings/user to set-user-settings channel", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "PATCH",
      url: "/api/v1/settings/user",
      body: JSON.stringify({ enableAutoUpdate: false }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith(
      "set-user-settings",
      [{ enableAutoUpdate: false }],
      {
        requestContext,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: { ok: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes dynamic path /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/chats", async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/42/chats",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("get-chats", [42], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: [] });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes OAuth2 config endpoint without auth context", async () => {
    resolveRequestContextMock.mockClear();
    const invoke = vi.fn().mockResolvedValue({ enabled: true });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/auth/oauth/config",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("get-oauth2-config", [], {
      requestContext: undefined,
    });
    expect(resolveRequestContextMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: { enabled: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes scoped path /api/v1/orgs/:orgId/workspaces/:workspaceId/apps", async () => {
    const invoke = vi.fn().mockResolvedValue({ apps: [] });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("list-apps", [], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: { apps: [] } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes proposal read endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({
      chatId: 42,
      messageId: 99,
      proposal: null,
    });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/42/proposal",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("get-proposal", [{ chatId: 42 }], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      data: {
        chatId: 42,
        messageId: 99,
        proposal: null,
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes proposal approval endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/chats/42/proposal/approve",
      body: JSON.stringify({ messageId: 7 }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith(
      "approve-proposal",
      [{ chatId: 42, messageId: 7 }],
      {
        requestContext,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: { success: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes app file read endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue("file-content");
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/77/file?path=src%2FApp.tsx",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith(
      "read-app-file",
      [{ appId: 77, filePath: "src/App.tsx" }],
      {
        requestContext,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: "file-content" });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes scoped app versions list endpoint", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([
        { oid: "abc", message: "Init", timestamp: 1, dbTimestamp: null },
      ]);
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/77/versions",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("list-versions", [{ appId: 77 }], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      data: [{ oid: "abc", message: "Init", timestamp: 1, dbTimestamp: null }],
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes scoped app checkout endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/77/versions/checkout",
      body: JSON.stringify({ versionId: "main" }),
    });
    const { response } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith(
      "checkout-version",
      [{ appId: 77, versionId: "main" }],
      {
        requestContext,
      },
    );
    expect(response.statusCode).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("routes scoped current branch endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ branch: "main" });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/77/branch",
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith("get-current-branch", [{ appId: 77 }], {
      requestContext,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({ data: { branch: "main" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("routes scoped app revert endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ successMessage: "Restored" });
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "POST",
      url: "/api/v1/orgs/org-1/workspaces/ws-1/apps/77/versions/revert",
      body: JSON.stringify({
        previousVersionId: "abc123",
        currentChatMessageId: { chatId: 42, messageId: 5 },
      }),
    });
    const { response, getBody } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(invoke).toHaveBeenCalledWith(
      "revert-version",
      [
        {
          appId: 77,
          previousVersionId: "abc123",
          currentChatMessageId: { chatId: 42, messageId: 5 },
        },
      ],
      {
        requestContext,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(getBody())).toEqual({
      data: { successMessage: "Restored" },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through unknown routes", async () => {
    const invoke = vi.fn();
    const middleware = createApiV1Middleware(invoke, {
      resolveRequestContext: resolveRequestContextMock as any,
    });
    const req = createMockRequest({
      method: "GET",
      url: "/health",
    });
    const { response } = createMockResponse();
    const next = vi.fn();

    await middleware(req, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });
});
