import { describe, expect, it } from "vitest";
import {
  appendResponseLanguageInstruction,
  buildResponseLanguageInstruction,
  resolveUiLanguage,
} from "./response_language_prompt";

describe("response language prompt utils", () => {
  it("defaults to ru when uiLanguage is missing", () => {
    expect(resolveUiLanguage(undefined)).toBe("ru");
    expect(resolveUiLanguage(null)).toBe("ru");
  });

  it("builds english instruction when uiLanguage is en", () => {
    const instruction = buildResponseLanguageInstruction("en");

    expect(instruction).toContain('selected interface language is "en"');
    expect(instruction).toContain("Write all user-facing prose in English");
  });

  it("appends language instruction to a base prompt", () => {
    const prompt = appendResponseLanguageInstruction("Base prompt", "ru");

    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain("# Response Language");
    expect(prompt).toContain("Write all user-facing prose in Russian");
  });
});
