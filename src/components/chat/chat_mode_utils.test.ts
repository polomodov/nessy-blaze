import { describe, expect, it } from "vitest";
import { isBuildLikeChatMode } from "./chat_mode_utils";

describe("isBuildLikeChatMode", () => {
  it("returns false only for ask mode", () => {
    expect(isBuildLikeChatMode("ask")).toBe(false);
    expect(isBuildLikeChatMode("build")).toBe(true);
    expect(isBuildLikeChatMode("agent")).toBe(true);
    expect(isBuildLikeChatMode("local-agent")).toBe(true);
    expect(isBuildLikeChatMode(undefined)).toBe(true);
  });
});
