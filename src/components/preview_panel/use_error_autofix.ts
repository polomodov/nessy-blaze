import { useCallback, useEffect, useRef } from "react";
import type { ConsoleEntry } from "@/ipc/ipc_types";
import type { UserSettings } from "@/lib/schemas";
import {
  buildAutoFixPrompt,
  selectRelevantAutoFixLogs,
  type AutoFixIncident,
  type AutoFixMode,
} from "./error_autofix_prompt";
import {
  createAutoFixPolicyState,
  recordAutofixAttempt,
  shouldTriggerAutofix,
  syncAutoFixPolicyContext,
  isNonActionableError,
} from "./error_autofix_policy";

type StreamMessageFn = (params: { prompt: string; chatId: number }) => void;

export function useErrorAutofix({
  selectedAppId,
  selectedChatId,
  settings,
  isStreaming,
  consoleEntries,
  streamMessage,
}: {
  selectedAppId: number | null;
  selectedChatId: number | null;
  settings: UserSettings | null;
  isStreaming: boolean;
  consoleEntries: ConsoleEntry[];
  streamMessage: StreamMessageFn;
}) {
  const policyStateRef = useRef(
    createAutoFixPolicyState({ appId: selectedAppId, chatId: selectedChatId }),
  );

  useEffect(() => {
    policyStateRef.current = syncAutoFixPolicyContext(policyStateRef.current, {
      appId: selectedAppId,
      chatId: selectedChatId,
    });
  }, [selectedAppId, selectedChatId]);

  const triggerAIFix = useCallback(
    ({
      mode,
      incident,
      chatId,
    }: {
      mode: AutoFixMode;
      incident: AutoFixIncident;
      chatId?: number;
    }) => {
      const targetChatId = chatId ?? selectedChatId;
      if (!targetChatId) {
        console.debug("[autofix] skip: no selectedChatId");
        return false;
      }

      if (incident.source === "blaze-app") {
        console.debug("[autofix] skip: blaze-app source is not auto-fixable");
        return false;
      }

      if (isNonActionableError(incident.primaryError)) {
        console.debug("[autofix] skip: non-actionable error");
        return false;
      }

      if (mode === "auto") {
        if (!settings?.enableAutoFixProblems) {
          console.debug("[autofix] skip: enableAutoFixProblems=false");
          return false;
        }

        if (settings.selectedChatMode === "ask") {
          console.debug("[autofix] skip: selectedChatMode=ask");
          return false;
        }

        if (isStreaming) {
          console.debug("[autofix] skip: chat is currently streaming");
          return false;
        }
      }

      const now = Date.now();
      const policyDecision = shouldTriggerAutofix({
        mode,
        fingerprint: incident.fingerprint,
        now,
        policyState: policyStateRef.current,
      });

      if (!policyDecision.allowed) {
        console.debug(
          `[autofix] skip: policy blocked (reason=${policyDecision.reason}, fingerprint=${incident.fingerprint})`,
        );
        return false;
      }

      const scopedLogs =
        selectedAppId == null
          ? consoleEntries
          : consoleEntries.filter((entry) => entry.appId === selectedAppId);
      const relevantLogs = selectRelevantAutoFixLogs({
        logs: scopedLogs,
        incidentTimestamp: incident.timestamp,
      });
      const prompt = buildAutoFixPrompt({
        mode,
        incident,
        logs: relevantLogs,
      });

      recordAutofixAttempt({
        mode,
        fingerprint: incident.fingerprint,
        now,
        policyState: policyStateRef.current,
      });

      console.debug(
        `[autofix] trigger: mode=${mode}, source=${incident.source}, fingerprint=${incident.fingerprint}, attempt=${policyDecision.attemptNumber}`,
      );
      streamMessage({
        prompt,
        chatId: targetChatId,
      });

      return true;
    },
    [
      selectedAppId,
      selectedChatId,
      settings?.enableAutoFixProblems,
      settings?.selectedChatMode,
      isStreaming,
      consoleEntries,
      streamMessage,
    ],
  );

  return {
    triggerAIFix,
  };
}
