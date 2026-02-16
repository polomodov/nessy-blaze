import type { IncomingMessage, ServerResponse } from "node:http";
import {
  doesHttpChatExist,
  insertHttpChatMessage,
  listHttpChatMessages,
  type HttpChatMessage,
} from "./ipc_http_gateway";

type Next = (error?: unknown) => void;

const STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream$/;
const CANCEL_STREAM_ROUTE = /^\/api\/v1\/chats\/(\d+)\/stream\/cancel$/;
const STREAM_CHUNK_DELAY_MS = 40;

const activeStreams = new Map<number, AbortController>();

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let rawBody = "";
  for await (const chunk of req) {
    rawBody += chunk.toString();
  }

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function writeSseEvent(
  res: ServerResponse,
  event: "chat:response:chunk" | "chat:response:end" | "chat:response:error",
  payload: unknown,
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createAssistantDraft(prompt: string): string {
  return `Understood. I am generating the first draft for: "${prompt}". I will structure the page, prepare content blocks, and then apply refinements.`;
}

function splitIntoStreamingChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const result: string[] = [];
  const chunkSize = 6;
  for (let index = 0; index < words.length; index += chunkSize) {
    result.push(words.slice(index, index + chunkSize).join(" "));
  }
  return result;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Stream aborted"));
    };

    if (signal.aborted) {
      clearTimeout(timeout);
      reject(new Error("Stream aborted"));
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveChatId(pathName: string, route: RegExp): number | null {
  const match = pathName.match(route);
  if (!match) {
    return null;
  }

  const chatId = Number(match[1]);
  if (!Number.isFinite(chatId)) {
    return null;
  }

  return chatId;
}

function withStreamingAssistant(
  messages: HttpChatMessage[],
  assistantText: string,
): HttpChatMessage[] {
  if (!assistantText.trim()) {
    return messages;
  }

  return [
    ...messages,
    {
      id: -1,
      role: "assistant",
      content: assistantText,
    },
  ];
}

export function createChatStreamMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const method = req.method?.toUpperCase();
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathName = requestUrl.pathname;

    const isStreamRoute = method === "POST" && STREAM_ROUTE.test(pathName);
    const isCancelRoute =
      method === "POST" && CANCEL_STREAM_ROUTE.test(pathName);

    if (!isStreamRoute && !isCancelRoute) {
      next();
      return;
    }

    if (isCancelRoute) {
      const chatId = resolveChatId(pathName, CANCEL_STREAM_ROUTE);
      if (chatId == null) {
        writeJson(res, 400, { error: "Invalid chatId in path" });
        return;
      }

      const controller = activeStreams.get(chatId);
      if (controller) {
        controller.abort();
        activeStreams.delete(chatId);
      }

      res.statusCode = 204;
      res.end();
      return;
    }

    const chatId = resolveChatId(pathName, STREAM_ROUTE);
    if (chatId == null) {
      writeJson(res, 400, { error: "Invalid chatId in path" });
      return;
    }

    let payload: { prompt?: unknown };
    try {
      payload = (await readJsonBody(req)) as { prompt?: unknown };
    } catch {
      writeJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const prompt =
      typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      writeJson(res, 400, { error: "Invalid payload: \"prompt\" is required" });
      return;
    }

    if (!doesHttpChatExist(chatId)) {
      writeJson(res, 404, { error: `Chat not found: ${chatId}` });
      return;
    }

    const previousController = activeStreams.get(chatId);
    if (previousController) {
      previousController.abort();
    }

    const abortController = new AbortController();
    activeStreams.set(chatId, abortController);

    req.on("close", () => {
      const activeController = activeStreams.get(chatId);
      if (activeController === abortController) {
        activeController.abort();
        activeStreams.delete(chatId);
      }
    });

    insertHttpChatMessage({
      chatId,
      role: "user",
      content: prompt,
    });
    const chatMessages = listHttpChatMessages(chatId);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    try {
      const assistantDraft = createAssistantDraft(prompt);
      const chunks = splitIntoStreamingChunks(assistantDraft);
      let incrementalText = "";

      for (const chunk of chunks) {
        if (abortController.signal.aborted) {
          break;
        }

        incrementalText = `${incrementalText} ${chunk}`.trim();
        writeSseEvent(res, "chat:response:chunk", {
          chatId,
          messages: withStreamingAssistant(chatMessages, incrementalText),
        });
        await delay(STREAM_CHUNK_DELAY_MS, abortController.signal);
      }

      if (incrementalText.trim()) {
        insertHttpChatMessage({
          chatId,
          role: "assistant",
          content: incrementalText,
        });
      }

      writeSseEvent(res, "chat:response:chunk", {
        chatId,
        messages: listHttpChatMessages(chatId),
      });
      writeSseEvent(res, "chat:response:end", {
        chatId,
        updatedFiles: false,
      });
      res.end();
    } catch (error) {
      if (abortController.signal.aborted) {
        writeSseEvent(res, "chat:response:end", {
          chatId,
          updatedFiles: false,
        });
        res.end();
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      writeSseEvent(res, "chat:response:error", {
        chatId,
        error: errorMessage,
      });
      writeSseEvent(res, "chat:response:end", {
        chatId,
        updatedFiles: false,
      });
      res.end();
    } finally {
      const activeController = activeStreams.get(chatId);
      if (activeController === abortController) {
        activeStreams.delete(chatId);
      }
    }
  };
}
