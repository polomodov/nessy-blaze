import { describe, expect, it } from "vitest";
import {
  AUTO_FIX_COOLDOWN_MS,
  AUTO_FIX_MAX_ATTEMPTS,
  computeFingerprint,
  createAutoFixPolicyState,
  isActionableServerError,
  isNonActionableError,
  recordAutofixAttempt,
  shouldTriggerAutofix,
  syncAutoFixPolicyContext,
} from "./error_autofix_policy";

describe("error_autofix_policy", () => {
  it("allows first auto attempt", () => {
    const state = createAutoFixPolicyState({ appId: 1, chatId: 10 });
    const fingerprint = computeFingerprint(
      "preview-runtime",
      "TypeError: Cannot read properties of undefined",
    );

    const decision = shouldTriggerAutofix({
      mode: "auto",
      fingerprint,
      now: 1_000,
      policyState: state,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.attemptNumber).toBe(1);
  });

  it("blocks immediate retry due to cooldown", () => {
    const state = createAutoFixPolicyState({ appId: 1, chatId: 10 });
    const fingerprint = computeFingerprint(
      "preview-build",
      "Header is not exported",
      "src/pages/Index.tsx",
    );

    recordAutofixAttempt({
      mode: "auto",
      fingerprint,
      now: 2_000,
      policyState: state,
    });

    const decision = shouldTriggerAutofix({
      mode: "auto",
      fingerprint,
      now: 2_000 + AUTO_FIX_COOLDOWN_MS - 1,
      policyState: state,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cooldown");
  });

  it("blocks after max attempts", () => {
    const state = createAutoFixPolicyState({ appId: 1, chatId: 10 });
    const fingerprint = computeFingerprint(
      "server-stderr",
      "error during build",
    );

    for (let i = 0; i < AUTO_FIX_MAX_ATTEMPTS; i++) {
      recordAutofixAttempt({
        mode: "auto",
        fingerprint,
        now: 10_000 + i * AUTO_FIX_COOLDOWN_MS,
        policyState: state,
      });
    }

    const decision = shouldTriggerAutofix({
      mode: "auto",
      fingerprint,
      now: 99_999_999,
      policyState: state,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("max-attempts");
  });

  it("allows manual mode even after max auto attempts", () => {
    const state = createAutoFixPolicyState({ appId: 1, chatId: 10 });
    const fingerprint = computeFingerprint(
      "preview-runtime",
      "ReferenceError: foo is not defined",
    );

    recordAutofixAttempt({
      mode: "auto",
      fingerprint,
      now: 1_000,
      policyState: state,
    });
    recordAutofixAttempt({
      mode: "auto",
      fingerprint,
      now: 1_000 + AUTO_FIX_COOLDOWN_MS,
      policyState: state,
    });

    const decision = shouldTriggerAutofix({
      mode: "manual",
      fingerprint,
      now: 1_000 + AUTO_FIX_COOLDOWN_MS + 1,
      policyState: state,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("manual");
  });

  it("resets policy state when app/chat context changes", () => {
    const original = createAutoFixPolicyState({ appId: 1, chatId: 10 });
    const fingerprint = computeFingerprint("preview-runtime", "TypeError");
    recordAutofixAttempt({
      mode: "auto",
      fingerprint,
      now: 1_111,
      policyState: original,
    });
    expect(original.attemptsByFingerprint.size).toBe(1);

    const synced = syncAutoFixPolicyContext(original, { appId: 2, chatId: 11 });
    expect(synced).not.toBe(original);
    expect(synced.attemptsByFingerprint.size).toBe(0);
  });

  it("detects actionable vs non-actionable server errors", () => {
    expect(
      isActionableServerError("[vite] Internal server error: TypeError"),
    ).toBe(true);
    expect(
      isActionableServerError("Error: Header is not exported by file"),
    ).toBe(true);
    expect(
      isNonActionableError(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      ),
    ).toBe(true);
    expect(
      isActionableServerError(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      ),
    ).toBe(false);
  });
});
