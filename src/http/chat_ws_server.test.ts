import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createChatWsSession } from "./chat_ws_server";

const baseContext = {
  userId: "user-1",
  externalSub: "sub-1",
  email: "user@example.com",
  displayName: "User One",
  orgId: "org-1",
  workspaceId: "ws-1",
  organizationRole: "owner",
  workspaceRole: "owner",
  roles: ["owner"],
  authSource: "dev-bypass",
} as const;

describe("chat_ws_server", () => {
  it("streams start_chat_stream messages with requestId and writes usage/audit", async () => {
    const sent: Array<{
      event: string;
      requestId?: string;
      payload: any;
    }> = [];

    const enforceUsage = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn().mockResolvedValue(undefined);

    const session = createChatWsSession({
      req: { headers: {} } as IncomingMessage,
      send: (payload) => {
        sent.push(JSON.parse(payload));
      },
      isOpen: () => true,
      resolveRequestContext: vi.fn().mockResolvedValue(baseContext),
      ensureChatInScope: vi.fn().mockResolvedValue(undefined),
      enforceAndRecordUsage: enforceUsage,
      writeAuditEvent: recordAudit,
      loadChatStreamHandlers: async () =>
        ({
          handleChatStreamRequest: async (
            event: any,
            req: { chatId: number },
          ) => {
            event.sender.send("chat:response:chunk", {
              chatId: req.chatId,
              textDelta: "chunk",
            });
            event.sender.send("chat:response:end", {
              chatId: req.chatId,
              updatedFiles: false,
              totalTokens: 7,
            });
          },
          handleChatCancelRequest: async () => true,
        }) as any,
    });

    await session.handleRawMessage(
      Buffer.from(
        JSON.stringify({
          type: "start_chat_stream",
          requestId: "req-1",
          orgId: "org-1",
          workspaceId: "ws-1",
          chatId: 42,
          prompt: "Build landing page",
        }),
      ),
    );

    // Allow detached quota/audit promises triggered on stream end to settle.
    await Promise.resolve();

    expect(sent).toEqual([
      {
        event: "chat:response:chunk",
        requestId: "req-1",
        payload: {
          chatId: 42,
          textDelta: "chunk",
        },
      },
      {
        event: "chat:response:end",
        requestId: "req-1",
        payload: {
          chatId: 42,
          updatedFiles: false,
          totalTokens: 7,
        },
      },
    ]);

    expect(enforceUsage).toHaveBeenCalledWith({
      context: baseContext,
      metricType: "requests",
      value: 1,
    });
    expect(enforceUsage).toHaveBeenCalledWith({
      context: baseContext,
      metricType: "tokens",
      value: 7,
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        context: baseContext,
        action: "chat_stream_start",
        resourceType: "chat",
        resourceId: 42,
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        context: baseContext,
        action: "chat_stream_end",
        resourceType: "chat",
        resourceId: 42,
      }),
    );
  });

  it("cancels active stream by requestId", async () => {
    const sent: Array<{ event: string; requestId?: string; payload: any }> = [];

    let resolveStream: (() => void) | null = null;
    const pendingStream = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    const handleChatStreamRequest = vi.fn(async () => pendingStream);
    const handleChatCancelRequest = vi.fn(async (event, chatId: number) => {
      event.sender.send("chat:response:end", {
        chatId,
        updatedFiles: false,
      });
      resolveStream?.();
      return true;
    });

    const session = createChatWsSession({
      req: { headers: {} } as IncomingMessage,
      send: (payload) => {
        sent.push(JSON.parse(payload));
      },
      isOpen: () => true,
      resolveRequestContext: vi.fn().mockResolvedValue(baseContext),
      ensureChatInScope: vi.fn().mockResolvedValue(undefined),
      enforceAndRecordUsage: vi.fn().mockResolvedValue(undefined),
      writeAuditEvent: vi.fn().mockResolvedValue(undefined),
      loadChatStreamHandlers: async () =>
        ({
          handleChatStreamRequest,
          handleChatCancelRequest,
        }) as any,
    });

    const startPromise = session.handleRawMessage(
      Buffer.from(
        JSON.stringify({
          type: "start_chat_stream",
          requestId: "req-2",
          orgId: "org-1",
          workspaceId: "ws-1",
          chatId: 77,
          prompt: "Create pricing page",
        }),
      ),
    );

    await vi.waitFor(() => {
      expect(handleChatStreamRequest).toHaveBeenCalledTimes(1);
    });

    await session.handleRawMessage(
      Buffer.from(
        JSON.stringify({
          type: "cancel_chat_stream",
          requestId: "req-2",
        }),
      ),
    );

    await startPromise;

    expect(handleChatCancelRequest).toHaveBeenCalledTimes(1);
    expect(handleChatCancelRequest).toHaveBeenCalledWith(
      expect.any(Object),
      77,
    );

    expect(sent).toContainEqual({
      event: "chat:response:end",
      requestId: "req-2",
      payload: {
        chatId: 77,
        updatedFiles: false,
      },
    });
  });
});
