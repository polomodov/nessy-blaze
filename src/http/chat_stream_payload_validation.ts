import type { ChatStreamParams, ComponentSelection } from "../ipc/ipc_types";

type AttachmentType = NonNullable<
  ChatStreamParams["attachments"]
>[number]["attachmentType"];

const ATTACHMENT_TYPES = new Set(["upload-to-codebase", "chat-context"]);
const ATTACHMENT_ALLOWED_KEYS = new Set([
  "name",
  "type",
  "data",
  "attachmentType",
]);
const COMPONENT_ALLOWED_KEYS = new Set([
  "id",
  "name",
  "runtimeId",
  "tagName",
  "textPreview",
  "domPath",
  "relativePath",
  "lineNumber",
  "columnNumber",
]);

function parseRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return parseRequiredString(value);
}

function isAttachmentType(value: unknown): value is AttachmentType {
  return (
    typeof value === "string" && ATTACHMENT_TYPES.has(value as AttachmentType)
  );
}

function hasOnlyAllowedKeys(
  payload: Record<string, unknown>,
  allowedKeys: Set<string>,
): boolean {
  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

function parseAttachment(
  value: unknown,
): NonNullable<ChatStreamParams["attachments"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(payload, ATTACHMENT_ALLOWED_KEYS)) {
    return null;
  }

  const name = parseRequiredString(payload.name);
  const type = parseRequiredString(payload.type);
  const data = payload.data;
  const attachmentType = payload.attachmentType;

  if (!name || !type || typeof data !== "string") {
    return null;
  }
  if (!isAttachmentType(attachmentType)) {
    return null;
  }

  return {
    name,
    type,
    data,
    attachmentType,
  };
}

function parseSelectedComponent(value: unknown): ComponentSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(payload, COMPONENT_ALLOWED_KEYS)) {
    return null;
  }

  const id = parseRequiredString(payload.id);
  const name = parseRequiredString(payload.name);
  const relativePath = parseRequiredString(payload.relativePath);
  const lineNumber = payload.lineNumber;
  const columnNumber = payload.columnNumber;
  const runtimeId = parseOptionalString(payload.runtimeId);
  const tagName = parseOptionalString(payload.tagName);
  const textPreview = parseOptionalString(payload.textPreview);
  const domPath = parseOptionalString(payload.domPath);

  if (
    !id ||
    !name ||
    !relativePath ||
    typeof lineNumber !== "number" ||
    !Number.isFinite(lineNumber) ||
    typeof columnNumber !== "number" ||
    !Number.isFinite(columnNumber)
  ) {
    return null;
  }
  if (
    runtimeId === null ||
    tagName === null ||
    textPreview === null ||
    domPath === null
  ) {
    return null;
  }

  return {
    id,
    name,
    runtimeId,
    tagName,
    textPreview,
    domPath,
    relativePath,
    lineNumber,
    columnNumber,
  };
}

export function parseOptionalAttachments(
  value: unknown,
): ChatStreamParams["attachments"] | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.map(parseAttachment);
  if (parsed.some((entry) => entry == null)) {
    return null;
  }
  return parsed as ChatStreamParams["attachments"];
}

export function parseOptionalSelectedComponents(
  value: unknown,
): ChatStreamParams["selectedComponents"] | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.map(parseSelectedComponent);
  if (parsed.some((entry) => entry == null)) {
    return null;
  }
  return parsed as ChatStreamParams["selectedComponents"];
}
