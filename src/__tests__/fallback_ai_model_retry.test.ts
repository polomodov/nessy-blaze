import { describe, expect, it } from "vitest";
import { defaultShouldRetryThisError } from "@/ipc/utils/fallback_ai_model";

describe("fallback_ai_model retry classification", () => {
  it("treats 404 provider errors as retryable for fallback chains", () => {
    expect(defaultShouldRetryThisError({ statusCode: 404 })).toBe(true);
  });

  it("does not retry unrelated non-retryable status codes", () => {
    expect(defaultShouldRetryThisError({ statusCode: 418 })).toBe(false);
  });
});
