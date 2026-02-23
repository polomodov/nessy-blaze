import { describe, expect, it } from "vitest";
import {
  constructSystemPrompt,
  getSystemPromptForChatMode,
} from "@/prompts/system_prompt";

describe("system_prompt chat mode contract", () => {
  it("returns build prompt and appends turbo edits block when enabled", () => {
    const buildPrompt = getSystemPromptForChatMode({
      chatMode: "build",
      enableTurboEditsV2: false,
    });
    const turboBuildPrompt = getSystemPromptForChatMode({
      chatMode: "build",
      enableTurboEditsV2: true,
    });

    expect(buildPrompt).toContain("<role> You are Blaze, an AI editor");
    expect(buildPrompt).toContain("Do *not* emit <blaze-command> tags.");
    expect(buildPrompt).not.toContain("<blaze-command type=");
    expect(turboBuildPrompt.length).toBeGreaterThan(buildPrompt.length);
  });

  it("returns ask prompt for ask mode", () => {
    const askPrompt = getSystemPromptForChatMode({
      chatMode: "ask",
      enableTurboEditsV2: true,
    });

    expect(askPrompt).toContain("NO CODE PRODUCTION");
  });

  it("injects ai rules and theme prompt in build mode", () => {
    const prompt = constructSystemPrompt({
      aiRules: "FOLLOW_PROJECT_GUIDELINES",
      chatMode: "build",
      enableTurboEditsV2: false,
      themePrompt: "THEME_PROMPT_TEST_BLOCK",
    });

    expect(prompt).toContain("FOLLOW_PROJECT_GUIDELINES");
    expect(prompt).toContain("THEME_PROMPT_TEST_BLOCK");
  });
});
