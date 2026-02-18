import { describe, expect, it } from "vitest";
import { createChatStreamStableEmitter } from "./chat_stream_core";

describe("createChatStreamStableEmitter", () => {
  it("emits chunk events and a single end event", () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const emitter = createChatStreamStableEmitter({
      chatId: 7,
      onEvent: (event) => events.push(event),
    });

    emitter.emitChunk({ chatId: 7, messages: [{ id: 1 }] });
    emitter.emitChunk({ chatId: 7, messages: [{ id: 2 }] });
    emitter.emitEnd({ chatId: 7, updatedFiles: false });
    emitter.emitChunk({ chatId: 7, messages: [{ id: 3 }] });
    emitter.emitEnd({ chatId: 7, updatedFiles: true });

    expect(events).toEqual([
      {
        event: "chat:response:chunk",
        payload: { chatId: 7, messages: [{ id: 1 }] },
      },
      {
        event: "chat:response:chunk",
        payload: { chatId: 7, messages: [{ id: 2 }] },
      },
      {
        event: "chat:response:end",
        payload: { chatId: 7, updatedFiles: false },
      },
    ]);
  });

  it("emits error followed by end exactly once", () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const emitter = createChatStreamStableEmitter({
      chatId: 9,
      onEvent: (event) => events.push(event),
    });

    emitter.emitError({ chatId: 9, error: "boom" });
    emitter.emitError({ chatId: 9, error: "ignored" });

    expect(events).toEqual([
      {
        event: "chat:response:error",
        payload: { chatId: 9, error: "boom" },
      },
      {
        event: "chat:response:end",
        payload: { chatId: 9, updatedFiles: false },
      },
    ]);
  });
});
