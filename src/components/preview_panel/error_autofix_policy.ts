import type {
  AutoFixIncidentSource,
  AutoFixMode,
} from "./error_autofix_prompt";

export const AUTO_FIX_MAX_ATTEMPTS = 2;
export const AUTO_FIX_COOLDOWN_MS = 90_000;

export interface AutoFixAttempt {
  count: number;
  lastAttemptAt: number;
}

export interface AutoFixPolicyState {
  appId: number | null;
  chatId: number | null;
  attemptsByFingerprint: Map<string, AutoFixAttempt>;
}

export interface AutoFixDecision {
  allowed: boolean;
  reason: "allowed" | "manual" | "cooldown" | "max-attempts";
  attemptNumber: number;
}

export function createAutoFixPolicyState({
  appId,
  chatId,
}: {
  appId: number | null;
  chatId: number | null;
}): AutoFixPolicyState {
  return {
    appId,
    chatId,
    attemptsByFingerprint: new Map(),
  };
}

export function syncAutoFixPolicyContext(
  state: AutoFixPolicyState,
  {
    appId,
    chatId,
  }: {
    appId: number | null;
    chatId: number | null;
  },
): AutoFixPolicyState {
  if (state.appId === appId && state.chatId === chatId) {
    return state;
  }

  return createAutoFixPolicyState({ appId, chatId });
}

function normalizeErrorForFingerprint(errorMessage: string): string {
  return errorMessage
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function computeFingerprint(
  source: AutoFixIncidentSource,
  primaryError: string,
  file?: string,
): string {
  const normalizedFile = (file ?? "").toLowerCase().trim();
  const normalizedError = normalizeErrorForFingerprint(primaryError);
  return `${source}|${normalizedFile}|${normalizedError}`;
}

export function shouldTriggerAutofix({
  mode,
  fingerprint,
  now,
  policyState,
}: {
  mode: AutoFixMode;
  fingerprint: string;
  now: number;
  policyState: AutoFixPolicyState;
}): AutoFixDecision {
  const existing = policyState.attemptsByFingerprint.get(fingerprint);
  const nextAttempt = (existing?.count ?? 0) + 1;

  if (mode === "manual") {
    return {
      allowed: true,
      reason: "manual",
      attemptNumber: nextAttempt,
    };
  }

  if (existing && existing.count >= AUTO_FIX_MAX_ATTEMPTS) {
    return {
      allowed: false,
      reason: "max-attempts",
      attemptNumber: nextAttempt,
    };
  }

  if (existing && now - existing.lastAttemptAt < AUTO_FIX_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      attemptNumber: nextAttempt,
    };
  }

  return {
    allowed: true,
    reason: "allowed",
    attemptNumber: nextAttempt,
  };
}

export function recordAutofixAttempt({
  mode,
  fingerprint,
  now,
  policyState,
}: {
  mode: AutoFixMode;
  fingerprint: string;
  now: number;
  policyState: AutoFixPolicyState;
}): void {
  if (mode !== "auto") {
    return;
  }

  const existing = policyState.attemptsByFingerprint.get(fingerprint);
  const count = (existing?.count ?? 0) + 1;
  policyState.attemptsByFingerprint.set(fingerprint, {
    count,
    lastAttemptAt: now,
  });
}

export function isNonActionableError(message: string): boolean {
  return /cannot connect to the docker|docker desktop/i.test(message);
}

export function isActionableServerError(message: string): boolean {
  if (isNonActionableError(message)) {
    return false;
  }

  return [
    /error/i,
    /failed/i,
    /exception/i,
    /\btypeerror\b/i,
    /\breferenceerror\b/i,
    /\bsyntaxerror\b/i,
    /cannot find module/i,
    /is not exported by/i,
    /error during build/i,
    /\bts\d{3,5}\b/i,
    /\[vite\].*error/i,
  ].some((pattern) => pattern.test(message));
}
