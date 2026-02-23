import { describe, expect, it } from "vitest";
import { createWsServerEvent, parseWsClientMessage } from "./chat_ws_adapter";

describe("chat_ws_adapter", () => {
  it("parses start_chat_stream payload", () => {
    const parsed = parseWsClientMessage(
      JSON.stringify({
        type: "start_chat_stream",
        requestId: "req-1",
        orgId: "org-1",
        workspaceId: "ws-1",
        chatId: 11,
        prompt: "Build a page",
      }),
    );

    expect(parsed).toEqual({
      type: "start_chat_stream",
      requestId: "req-1",
      orgId: "org-1",
      workspaceId: "ws-1",
      chatId: 11,
      prompt: "Build a page",
      redo: undefined,
      attachments: undefined,
      selectedComponents: undefined,
    });
  });

  it("normalizes start_chat_stream required string fields", () => {
    const parsed = parseWsClientMessage(
      JSON.stringify({
        type: "start_chat_stream",
        requestId: "  req-2  ",
        orgId: "  org-2  ",
        workspaceId: "  ws-2  ",
        chatId: 12,
        prompt: "  Build a dashboard  ",
      }),
    );

    expect(parsed).toEqual({
      type: "start_chat_stream",
      requestId: "req-2",
      orgId: "org-2",
      workspaceId: "ws-2",
      chatId: 12,
      prompt: "Build a dashboard",
      redo: undefined,
      attachments: undefined,
      selectedComponents: undefined,
    });
  });

  it("rejects invalid start_chat_stream payload values", () => {
    expect(() =>
      parseWsClientMessage(
        JSON.stringify({
          type: "start_chat_stream",
          requestId: "req-1",
          orgId: "",
          workspaceId: "ws-1",
          chatId: 11,
          prompt: "Build a page",
        }),
      ),
    ).toThrow("Invalid start_chat_stream payload");

    expect(() =>
      parseWsClientMessage(
        JSON.stringify({
          type: "start_chat_stream",
          requestId: "req-1",
          orgId: "org-1",
          workspaceId: "ws-1",
          chatId: null,
          prompt: "Build a page",
        }),
      ),
    ).toThrow("Invalid start_chat_stream payload");
  });

  it("parses cancel_chat_stream payload", () => {
    const parsed = parseWsClientMessage(
      JSON.stringify({
        type: "cancel_chat_stream",
        requestId: "req-1",
      }),
    );

    expect(parsed).toEqual({
      type: "cancel_chat_stream",
      requestId: "req-1",
    });
  });

  it("rejects cancel_chat_stream payload without requestId", () => {
    expect(() =>
      parseWsClientMessage(
        JSON.stringify({
          type: "cancel_chat_stream",
        }),
      ),
    ).toThrow("Invalid cancel_chat_stream payload: requestId is required");
  });

  it("rejects cancel_chat_stream payload with blank requestId", () => {
    expect(() =>
      parseWsClientMessage(
        JSON.stringify({
          type: "cancel_chat_stream",
          requestId: "   ",
        }),
      ),
    ).toThrow("Invalid cancel_chat_stream payload: requestId is required");
  });

  it("serializes server events", () => {
    const serialized = createWsServerEvent({
      event: "chat:response:end",
      requestId: "req-1",
      payload: {
        chatId: 11,
        updatedFiles: false,
      },
    });

    expect(JSON.parse(serialized)).toEqual({
      event: "chat:response:end",
      requestId: "req-1",
      payload: {
        chatId: 11,
        updatedFiles: false,
      },
    });
  });
});
