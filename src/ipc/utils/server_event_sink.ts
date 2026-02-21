export interface EventSenderLike {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed?(): boolean;
  isCrashed?(): boolean;
}

export interface ServerEventSink {
  send(channel: string, ...args: unknown[]): void;
  isClosed(): boolean;
}

export type ServerEventTarget =
  | ServerEventSink
  | EventSenderLike
  | null
  | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isServerEventSink(value: unknown): value is ServerEventSink {
  return (
    isObject(value) &&
    typeof value.send === "function" &&
    typeof value.isClosed === "function"
  );
}

function isSenderClosed(sender: EventSenderLike | null | undefined): boolean {
  if (!sender) {
    return true;
  }
  if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) {
    return true;
  }
  if (typeof sender.isCrashed === "function" && sender.isCrashed()) {
    return true;
  }
  return false;
}

export function toServerEventSink(target: ServerEventTarget): ServerEventSink {
  if (isServerEventSink(target)) {
    return target;
  }

  const sender = target;
  return {
    send(channel: string, ...args: unknown[]) {
      if (!sender || isSenderClosed(sender)) {
        return;
      }
      sender.send(channel, ...args);
    },
    isClosed() {
      return isSenderClosed(sender);
    },
  };
}

export function createServerEventSinkFromEvent(
  event: { sender?: EventSenderLike | null } | null | undefined,
): ServerEventSink {
  return toServerEventSink(event?.sender);
}

export const NOOP_SERVER_EVENT_SINK: ServerEventSink = {
  send() {},
  isClosed() {
    return true;
  },
};
