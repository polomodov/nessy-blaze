import type { ChatResponseEnd } from "../ipc/ipc_types";

export type ChatStreamEventName =
  | "chat:response:chunk"
  | "chat:response:error"
  | "chat:response:end";

export interface ChatStreamEvent {
  event: ChatStreamEventName;
  payload: unknown;
}

export interface ChatStreamStableEmitter {
  emitChunk(payload: unknown): void;
  emitError(payload: unknown): void;
  emitEnd(payload: ChatResponseEnd): void;
  isEnded(): boolean;
}

export function createChatStreamStableEmitter(params: {
  chatId: number;
  onEvent: (event: ChatStreamEvent) => void;
}): ChatStreamStableEmitter {
  let ended = false;

  const emitEvent = (event: ChatStreamEventName, payload: unknown) => {
    if (ended) {
      return;
    }
    params.onEvent({ event, payload });
  };

  return {
    emitChunk(payload) {
      emitEvent("chat:response:chunk", payload);
    },
    emitError(payload) {
      if (ended) {
        return;
      }
      emitEvent("chat:response:error", payload);
      this.emitEnd({
        chatId: params.chatId,
        updatedFiles: false,
      });
    },
    emitEnd(payload) {
      if (ended) {
        return;
      }
      ended = true;
      params.onEvent({
        event: "chat:response:end",
        payload,
      });
    },
    isEnded() {
      return ended;
    },
  };
}
