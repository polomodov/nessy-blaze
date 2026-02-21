import log from "electron-log";
import {
  toServerEventSink,
  type EventSenderLike,
  type ServerEventSink,
} from "./server_event_sink";

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
    log.debug(
      `safeSend: failed to send on channel "${channel}" because: ${(error as Error).message}`,
    );
  }
}
