import { log } from "/src/lib/logger.ts";
import {
  toServerEventSink,
  type EventSenderLike,
  type ServerEventSink,
} from "/src/ipc/utils/server_event_sink.ts";

const logger = log.scope("safe_sender");

/**
 * Sends a backend event only if the target transport is still alive.
 * This prevents late-send errors when async callbacks outlive the client
 * connection (window close, SSE disconnect, websocket close, etc.).
 */
export function safeSend(
  target: ServerEventSink | EventSenderLike | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  const sink = toServerEventSink(target);
  if (sink.isClosed()) return;

  try {
    sink.send(channel, ...args);
  } catch (error) {
    logger.debug(
      `safeSend: failed to send on channel "${channel}" because: ${(error as Error).message}`,
    );
  }
}
