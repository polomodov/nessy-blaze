import { describe, expect, it } from "vitest";
import type { ConsoleEntry } from "@/ipc/ipc_types";
import {
  AUTO_FIX_MAX_DIAGNOSTIC_CHARS,
  buildAutoFixPrompt,
  normalizeLogMessage,
  selectRelevantAutoFixLogs,
  type AutoFixIncident,
} from "./error_autofix_prompt";

function createLog(
  overrides: Partial<ConsoleEntry> = {},
  index = 0,
): ConsoleEntry {
  return {
    appId: 1,
    level: "error",
    type: "server",
    message: `Server error #${index}`,
    timestamp: 1_700_000_000_000 + index,
    ...overrides,
  };
}

describe("error_autofix_prompt", () => {
  it("builds deterministic prompt with primary error, route, file, frame and logs", () => {
    const incident: AutoFixIncident = {
      source: "preview-build",
      primaryError: "Header is not exported by src/components/Header.tsx",
      fingerprint: "preview-build|src/pages/index.tsx|header is not exported",
      timestamp: 1_700_000_050_000,
      route: "/",
      file: "src/pages/Index.tsx",
      frame: "import { Header } from '@/components/Header'",
    };
    const logs = [
      createLog({ type: "client", level: "warn", message: "vite warn" }, 1),
      createLog({ type: "server", level: "error", message: "build failed" }, 2),
    ];

    const prompt = buildAutoFixPrompt({
      mode: "auto",
      incident,
      logs,
    });

    expect(prompt).toContain("Auto-fix detected");
    expect(prompt).toContain("Source: preview-build");
    expect(prompt).toContain("Route: /");
    expect(prompt).toContain("File: src/pages/Index.tsx");
    expect(prompt).toContain("Build frame:");
    expect(prompt).toContain("Header is not exported");
    expect(prompt).toContain("[client] [WARN] vite warn");
    expect(prompt).toContain("[server] [ERROR] build failed");
  });

  it("trims long log messages and keeps diagnostics block bounded", () => {
    const longMessage = `${"x".repeat(1_500)} end`;
    const normalizedMessage = normalizeLogMessage(longMessage);
    expect(normalizedMessage.length).toBeLessThanOrEqual(400);

    const incident: AutoFixIncident = {
      source: "preview-runtime",
      primaryError: "TypeError: Cannot read properties of undefined",
      fingerprint: "fp-typeerror",
      timestamp: 1_700_000_000_500,
    };
    const manyLogs = Array.from({ length: 60 }, (_, index) =>
      createLog({ message: longMessage }, index),
    );

    const selectedLogs = selectRelevantAutoFixLogs({
      logs: manyLogs,
      incidentTimestamp: incident.timestamp,
    });
    expect(selectedLogs.length).toBeLessThanOrEqual(30);

    const prompt = buildAutoFixPrompt({
      mode: "manual",
      incident,
      logs: selectedLogs,
    });

    const diagnostics = prompt.split("Diagnostics:\n")[1] ?? "";
    expect(diagnostics.length).toBeLessThanOrEqual(
      AUTO_FIX_MAX_DIAGNOSTIC_CHARS,
    );
  });

  it("handles sparse input without crashing", () => {
    const incident: AutoFixIncident = {
      source: "server-stderr",
      primaryError: "Unknown error",
      fingerprint: "server|unknown",
      timestamp: Date.now(),
    };

    const prompt = buildAutoFixPrompt({
      mode: "auto",
      incident,
      logs: [],
    });

    expect(prompt).toContain("No relevant logs captured");
    expect(prompt).toContain("Route: unknown");
  });

  it("returns identical prompt for identical input", () => {
    const incident: AutoFixIncident = {
      source: "preview-runtime",
      primaryError: "ReferenceError: foo is not defined",
      fingerprint: "preview-runtime|foo",
      timestamp: 1_700_000_123_456,
      route: "/settings",
    };
    const logs = [createLog({ message: "ReferenceError in widget" }, 3)];

    const first = buildAutoFixPrompt({
      mode: "auto",
      incident,
      logs,
    });
    const second = buildAutoFixPrompt({
      mode: "auto",
      incident,
      logs,
    });

    expect(first).toEqual(second);
  });
});
