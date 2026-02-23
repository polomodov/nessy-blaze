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
  requestId: string;
}

export type WsClientMessage =
  | WsStartChatStreamMessage
  | WsCancelChatStreamMessage;

export interface WsServerEvent {
  event: "chat:response:chunk" | "chat:response:error" | "chat:response:end";
  requestId?: string;
  payload: unknown;
}

function parseRequiredNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
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
    const requestId = parseRequiredNonEmptyString(msg.requestId);
    const orgId = parseRequiredNonEmptyString(msg.orgId);
    const workspaceId = parseRequiredNonEmptyString(msg.workspaceId);
    const prompt = parseRequiredNonEmptyString(msg.prompt);
    const chatId =
      typeof msg.chatId === "number" && Number.isFinite(msg.chatId)
        ? msg.chatId
        : null;
    if (!requestId || !orgId || !workspaceId || chatId == null || !prompt) {
      throw new Error("Invalid start_chat_stream payload");
    }
    return {
      type: "start_chat_stream",
      requestId,
      orgId,
      workspaceId,
      chatId,
      prompt,
      redo: msg.redo,
      attachments: msg.attachments,
      selectedComponents: msg.selectedComponents,
    };
  }

  if (type === "cancel_chat_stream") {
    const msg = parsed as Partial<WsCancelChatStreamMessage>;
    const requestId = parseRequiredNonEmptyString(msg.requestId);
    if (!requestId) {
      throw new Error(
        "Invalid cancel_chat_stream payload: requestId is required",
      );
    }
    return {
      type: "cancel_chat_stream",
      requestId,
    };
  }

  throw new Error("Unsupported WebSocket message type");
}

export function createWsServerEvent(params: WsServerEvent): string {
  return JSON.stringify(params);
}
