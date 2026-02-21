import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsoleEntry } from "@/ipc/ipc_types";
import { useErrorAutofix } from "./use_error_autofix";
import type { AutoFixIncident } from "./error_autofix_prompt";

function createIncident(
  overrides: Partial<AutoFixIncident> = {},
): AutoFixIncident {
  return {
    source: "preview-runtime",
    primaryError: "TypeError: Cannot read properties of undefined",
    fingerprint: "preview-runtime|typeerror",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function createLog(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    appId: 1,
    level: "error",
    type: "server",
    message: "Error during build",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("useErrorAutofix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers streamMessage for auto mode with enriched prompt", () => {
    const streamMessage = vi.fn();
    const { result } = renderHook(() =>
      useErrorAutofix({
        selectedAppId: 1,
        selectedChatId: 99,
        settings: {
          enableAutoFixProblems: true,
          selectedChatMode: "build",
        } as any,
        isStreaming: false,
        consoleEntries: [createLog()],
        streamMessage,
      }),
    );

    act(() => {
      result.current.triggerAIFix({
        mode: "auto",
        incident: createIncident(),
      });
    });

    expect(streamMessage).toHaveBeenCalledOnce();
    expect(streamMessage.mock.calls[0][0].chatId).toBe(99);
    expect(streamMessage.mock.calls[0][0].prompt).toContain("Diagnostics:");
    expect(streamMessage.mock.calls[0][0].prompt).toContain("TypeError");
  });

  it("does not auto-fix blaze-app incidents", () => {
    const streamMessage = vi.fn();
    const { result } = renderHook(() =>
      useErrorAutofix({
        selectedAppId: 1,
        selectedChatId: 99,
        settings: {
          enableAutoFixProblems: true,
          selectedChatMode: "build",
        } as any,
        isStreaming: false,
        consoleEntries: [],
        streamMessage,
      }),
    );

    act(() => {
      result.current.triggerAIFix({
        mode: "auto",
        incident: createIncident({ source: "blaze-app", fingerprint: "blaze" }),
      });
    });

    expect(streamMessage).not.toHaveBeenCalled();
  });

  it("deduplicates repeated server-stderr auto attempts within cooldown", () => {
    const streamMessage = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    const { result } = renderHook(() =>
      useErrorAutofix({
        selectedAppId: 1,
        selectedChatId: 99,
        settings: {
          enableAutoFixProblems: true,
          selectedChatMode: "build",
        } as any,
        isStreaming: false,
        consoleEntries: [createLog()],
        streamMessage,
      }),
    );

    const incident = createIncident({
      source: "server-stderr",
      primaryError: "Error during build: Header is not exported",
      fingerprint: "server-stderr|header-export",
    });

    act(() => {
      result.current.triggerAIFix({ mode: "auto", incident });
      result.current.triggerAIFix({ mode: "auto", incident });
    });

    expect(streamMessage).toHaveBeenCalledTimes(1);
  });

  it("allows manual trigger with explicit chatId override", () => {
    const streamMessage = vi.fn();
    const { result } = renderHook(() =>
      useErrorAutofix({
        selectedAppId: 1,
        selectedChatId: null,
        settings: {
          enableAutoFixProblems: true,
          selectedChatMode: "build",
        } as any,
        isStreaming: false,
        consoleEntries: [createLog()],
        streamMessage,
      }),
    );

    act(() => {
      result.current.triggerAIFix({
        mode: "manual",
        chatId: 77,
        incident: createIncident(),
      });
    });

    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect(streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 77,
      }),
    );
  });

  it("skips auto-fix while chat stream is active", () => {
    const streamMessage = vi.fn();
    const { result } = renderHook(() =>
      useErrorAutofix({
        selectedAppId: 1,
        selectedChatId: 99,
        settings: {
          enableAutoFixProblems: true,
          selectedChatMode: "build",
        } as any,
        isStreaming: true,
        consoleEntries: [createLog()],
        streamMessage,
      }),
    );

    act(() => {
      result.current.triggerAIFix({
        mode: "auto",
        incident: createIncident(),
      });
    });

    expect(streamMessage).not.toHaveBeenCalled();
  });
});
