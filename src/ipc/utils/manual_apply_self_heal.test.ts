import { describe, expect, it, vi } from "vitest";
import { applyManualChangesWithSelfHealing } from "./manual_apply_self_heal";

describe("applyManualChangesWithSelfHealing", () => {
  it("returns immediately when initial apply succeeds", async () => {
    const applyResponse = vi
      .fn()
      .mockResolvedValue({ updatedFiles: true, extraFiles: ["README.md"] });

    const result = await applyManualChangesWithSelfHealing({
      rawResponse:
        '<blaze-write path="src/App.tsx">export default 1;</blaze-write>',
      applyResponse,
    });

    expect(applyResponse).toHaveBeenCalledTimes(1);
    expect(result.recoveredBySelfHealing).toBe(false);
    expect(result.attempts).toEqual([
      { strategy: "initial", error: undefined },
    ]);
    expect(result.processResult.updatedFiles).toBe(true);
  });

  it("retries with actionable-only payload when available", async () => {
    const applyResponse = vi
      .fn()
      .mockResolvedValueOnce({ error: "Failed to parse mixed payload" })
      .mockResolvedValueOnce({ updatedFiles: true });

    const rawResponse = `
      Plan:
      <blaze-chat-summary>Update landing hero</blaze-chat-summary>
      <blaze-write path="src/App.tsx">export default function App(){return <main />}</blaze-write>
      Done.
    `;

    const result = await applyManualChangesWithSelfHealing({
      rawResponse,
      applyResponse,
    });

    expect(applyResponse).toHaveBeenCalledTimes(2);
    expect(applyResponse.mock.calls[1]?.[0]).toContain("<blaze-chat-summary>");
    expect(applyResponse.mock.calls[1]?.[0]).toContain("<blaze-write");
    expect(applyResponse.mock.calls[1]?.[0]).not.toContain("Plan:");
    expect(applyResponse.mock.calls[1]?.[0]).not.toContain("Done.");
    expect(result.recoveredBySelfHealing).toBe(true);
    expect(result.attempts[1]).toEqual({
      strategy: "retry-actionable-tags",
      error: undefined,
    });
  });

  it("retries with the same payload for retryable errors", async () => {
    const applyResponse = vi
      .fn()
      .mockResolvedValueOnce({
        error:
          "fatal: Unable to create '/app/.git/index.lock': File exists. Another git process seems to be running.",
      })
      .mockResolvedValueOnce({ updatedFiles: true });

    const result = await applyManualChangesWithSelfHealing({
      rawResponse: "   no actionable tags in this response   ",
      applyResponse,
    });

    expect(applyResponse).toHaveBeenCalledTimes(2);
    expect(applyResponse.mock.calls[0]?.[0]).toBe(
      "no actionable tags in this response",
    );
    expect(applyResponse.mock.calls[1]?.[0]).toBe(
      "no actionable tags in this response",
    );
    expect(result.recoveredBySelfHealing).toBe(true);
    expect(result.attempts[1]).toEqual({
      strategy: "retry-same-payload",
      error: undefined,
    });
  });

  it("does not retry non-retryable errors when no healing payload exists", async () => {
    const applyResponse = vi
      .fn()
      .mockResolvedValue({ error: "SyntaxError: Unexpected token '<'" });

    const result = await applyManualChangesWithSelfHealing({
      rawResponse: "plain explanation without blaze tags",
      applyResponse,
    });

    expect(applyResponse).toHaveBeenCalledTimes(1);
    expect(result.recoveredBySelfHealing).toBe(false);
    expect(result.attempts).toEqual([
      { strategy: "initial", error: "SyntaxError: Unexpected token '<'" },
    ]);
  });

  it("returns the final failure after self-healing attempts are exhausted", async () => {
    const applyResponse = vi
      .fn()
      .mockResolvedValueOnce({
        error: "fatal: Unable to create '/app/.git/index.lock': File exists",
      })
      .mockResolvedValueOnce({
        error: "fatal: Unable to create '/app/.git/index.lock': File exists",
      });

    const result = await applyManualChangesWithSelfHealing({
      rawResponse: "no tags",
      applyResponse,
    });

    expect(applyResponse).toHaveBeenCalledTimes(2);
    expect(result.recoveredBySelfHealing).toBe(false);
    expect(result.attempts).toEqual([
      {
        strategy: "initial",
        error: "fatal: Unable to create '/app/.git/index.lock': File exists",
      },
      {
        strategy: "retry-same-payload",
        error: "fatal: Unable to create '/app/.git/index.lock': File exists",
      },
    ]);
    expect(result.processResult.error).toContain("index.lock");
  });
});
