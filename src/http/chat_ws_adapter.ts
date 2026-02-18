import type { ChatStreamParams } from "../ipc/ipc_types";

export interface WsStartChatStreamMessage
  extends Omit<ChatStreamParams, "chatId" | "prompt"> {
  type: "start_chat_stream";
  requestId: string;
  orgId: string;
  workspaceId: string;
  chatId: number;
  prompt: string;
}

export interface WsCancelChatStreamMessage {
  type: "cancel_chat_stream";
  requestId?: string;
  chatId?: number;
}

export type WsClientMessage =
  | WsStartChatStreamMessage
  | WsCancelChatStreamMessage;

export interface WsServerEvent {
  event: "chat:response:chunk" | "chat:response:error" | "chat:response:end";
  requestId?: string;
  payload: unknown;
}

export function parseWsClientMessage(raw: string): WsClientMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid WebSocket JSON payload");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid WebSocket payload");
  }

  const type = (parsed as Record<string, unknown>).type;
  if (type === "start_chat_stream") {
    const msg = parsed as Partial<WsStartChatStreamMessage>;
    if (
      typeof msg.requestId !== "string" ||
      typeof msg.orgId !== "string" ||
      typeof msg.workspaceId !== "string" ||
      typeof msg.chatId !== "number" ||
      typeof msg.prompt !== "string"
    ) {
      throw new Error("Invalid start_chat_stream payload");
    }
    return {
      type: "start_chat_stream",
      requestId: msg.requestId,
      orgId: msg.orgId,
      workspaceId: msg.workspaceId,
      chatId: msg.chatId,
      prompt: msg.prompt,
      redo: msg.redo,
      attachments: msg.attachments,
      selectedComponents: msg.selectedComponents,
    };
  }

  if (type === "cancel_chat_stream") {
    const msg = parsed as Partial<WsCancelChatStreamMessage>;
    if (typeof msg.requestId !== "string" && typeof msg.chatId !== "number") {
      throw new Error(
        "Invalid cancel_chat_stream payload: requestId or chatId is required",
      );
    }
    return {
      type: "cancel_chat_stream",
      requestId: msg.requestId,
      chatId: msg.chatId,
    };
  }

  throw new Error("Unsupported WebSocket message type");
}

export function createWsServerEvent(params: WsServerEvent): string {
  return JSON.stringify(params);
}
