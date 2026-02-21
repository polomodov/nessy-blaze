import log from "electron-log";
import { extractActionableBlazeTags } from "./actionable_blaze_tags";

const logger = log.scope("manual_apply_self_heal");

export const MANUAL_APPLY_MAX_ATTEMPTS = 2;

const RETRYABLE_ERROR_PATTERNS = [
  /index\.lock/i,
  /cannot lock ref/i,
  /another git process/i,
  /\bEBUSY\b/i,
  /\bEAGAIN\b/i,
  /\bENOTEMPTY\b/i,
  /resource busy/i,
  /temporarily unavailable/i,
  /timed out/i,
  /timeout/i,
];

export type ApplyProcessResult = {
  updatedFiles?: boolean;
  error?: string;
  extraFiles?: string[];
  extraFilesError?: string;
};

export type ManualApplyAttemptStrategy =
  | "initial"
  | "retry-actionable-tags"
  | "retry-same-payload";

export type ManualApplyAttempt = {
  strategy: ManualApplyAttemptStrategy;
  error?: string;
};

export type ManualApplySelfHealingResult = {
  processResult: ApplyProcessResult;
  attempts: ManualApplyAttempt[];
  recoveredBySelfHealing: boolean;
};

export function isRetryableManualApplyError(
  error: string | undefined,
): boolean {
  if (!error) {
    return false;
  }
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

export async function applyManualChangesWithSelfHealing({
  rawResponse,
  applyResponse,
}: {
  rawResponse: string;
  applyResponse: (responsePayload: string) => Promise<ApplyProcessResult>;
}): Promise<ManualApplySelfHealingResult> {
  const attempts: ManualApplyAttempt[] = [];
  const normalizedPayload = rawResponse.trim();

  const initialResult = await applyResponse(normalizedPayload);
  attempts.push({ strategy: "initial", error: initialResult.error });
  if (!initialResult.error) {
    return {
      processResult: initialResult,
      attempts,
      recoveredBySelfHealing: false,
    };
  }

  if (attempts.length >= MANUAL_APPLY_MAX_ATTEMPTS) {
    return {
      processResult: initialResult,
      attempts,
      recoveredBySelfHealing: false,
    };
  }

  const actionablePayload = extractActionableBlazeTags(normalizedPayload);
  const shouldRetryWithActionablePayload =
    actionablePayload.length > 0 && actionablePayload !== normalizedPayload;

  const retryStrategy: ManualApplyAttemptStrategy | null =
    shouldRetryWithActionablePayload
      ? "retry-actionable-tags"
      : isRetryableManualApplyError(initialResult.error)
        ? "retry-same-payload"
        : null;

  if (!retryStrategy) {
    logger.warn(
      "Manual apply failed and no self-healing retry strategy matched",
      JSON.stringify({
        initialError: initialResult.error,
      }),
    );
    return {
      processResult: initialResult,
      attempts,
      recoveredBySelfHealing: false,
    };
  }

  const retryPayload =
    retryStrategy === "retry-actionable-tags"
      ? actionablePayload
      : normalizedPayload;

  logger.warn(
    "Manual apply self-healing retry",
    JSON.stringify({
      strategy: retryStrategy,
    }),
  );
  const retryResult = await applyResponse(retryPayload);
  attempts.push({ strategy: retryStrategy, error: retryResult.error });

  return {
    processResult: retryResult,
    attempts,
    recoveredBySelfHealing: !retryResult.error,
  };
}
