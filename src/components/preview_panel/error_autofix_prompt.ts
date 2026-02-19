import type { ConsoleEntry } from "@/ipc/ipc_types";

export const AUTO_FIX_MAX_LOGS = 30;
export const AUTO_FIX_MAX_LOG_MESSAGE_CHARS = 400;
export const AUTO_FIX_MAX_DIAGNOSTIC_CHARS = 12_000;

export type AutoFixMode = "auto" | "manual";
export type AutoFixIncidentSource =
  | "preview-runtime"
  | "preview-build"
  | "server-stderr"
  | "blaze-app";

export interface AutoFixIncident {
  source: AutoFixIncidentSource;
  primaryError: string;
  fingerprint: string;
  timestamp: number;
  route?: string;
  file?: string;
  frame?: string;
}

const SUPPORTED_LOG_TYPES = new Set<ConsoleEntry["type"]>([
  "server",
  "client",
  "network-requests",
]);

function trimToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 15)}...[truncated]`;
}

export function normalizeLogMessage(message: string): string {
  return trimToLength(
    message.replace(/\s+/g, " ").trim(),
    AUTO_FIX_MAX_LOG_MESSAGE_CHARS,
  );
}

export function selectRelevantAutoFixLogs({
  logs,
  incidentTimestamp,
  maxLogs = AUTO_FIX_MAX_LOGS,
}: {
  logs: ConsoleEntry[];
  incidentTimestamp: number;
  maxLogs?: number;
}): ConsoleEntry[] {
  const candidateLogs = logs
    .filter((entry) => SUPPORTED_LOG_TYPES.has(entry.type))
    .filter(
      (entry) =>
        entry.level === "error" ||
        entry.level === "warn" ||
        entry.type === "server",
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (candidateLogs.length === 0) {
    return [];
  }

  const aroundIncident = candidateLogs.filter(
    (entry) => entry.timestamp <= incidentTimestamp + 5_000,
  );
  const scopedLogs = aroundIncident.length > 0 ? aroundIncident : candidateLogs;

  return scopedLogs.slice(-Math.max(1, maxLogs));
}

function formatLogsForPrompt(logs: ConsoleEntry[]): string[] {
  return logs.map((entry) => {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase();
    const type = entry.type;
    const message = normalizeLogMessage(entry.message);
    return `- [${timestamp}] [${type}] [${level}] ${message}`;
  });
}

export function buildAutoFixPrompt({
  mode,
  incident,
  logs,
}: {
  mode: AutoFixMode;
  incident: AutoFixIncident;
  logs: ConsoleEntry[];
}): string {
  const header =
    mode === "auto"
      ? "Auto-fix detected a preview/build issue. Diagnose and fix it."
      : "Manual fix request for a preview/build issue.";

  const instructions = [
    "Find the root cause using the diagnostics below.",
    "Apply minimal, targeted changes.",
    "Return code edits only via Blaze tags (e.g. <blaze-write>, <blaze-search-replace>, <blaze-rename>, <blaze-delete>).",
    "Do not rewrite unrelated files.",
  ].join("\n");

  const incidentLines = [
    `Source: ${incident.source}`,
    `Fingerprint: ${incident.fingerprint}`,
    `Timestamp: ${new Date(incident.timestamp).toISOString()}`,
    `Route: ${incident.route ?? "unknown"}`,
    `File: ${incident.file ?? "unknown"}`,
    "Primary error:",
    trimToLength(incident.primaryError.trim(), 2_000),
  ];

  if (incident.frame?.trim()) {
    incidentLines.push("Build frame:");
    incidentLines.push(trimToLength(incident.frame.trim(), 2_000));
  }

  const logLines = formatLogsForPrompt(logs);
  const diagnosticsChunks: string[] = [
    "Diagnostics:",
    ...incidentLines,
    "Relevant logs:",
    ...(logLines.length > 0 ? logLines : ["- No relevant logs captured."]),
  ];

  while (
    diagnosticsChunks.join("\n").length > AUTO_FIX_MAX_DIAGNOSTIC_CHARS &&
    logLines.length > 0
  ) {
    logLines.shift();
    diagnosticsChunks.splice(
      diagnosticsChunks.findIndex((line) => line === "Relevant logs:") + 1,
      diagnosticsChunks.length,
      ...(logLines.length > 0
        ? logLines
        : ["- Logs truncated due to size constraints."]),
    );
  }

  const diagnosticsBlock = diagnosticsChunks.join("\n");

  return [header, instructions, diagnosticsBlock].join("\n\n");
}
