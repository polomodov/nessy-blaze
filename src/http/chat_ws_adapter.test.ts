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
      chatId: undefined,
    });
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
