import type { UserSettings } from "@/lib/schemas";

export type ResponseLanguage = "ru" | "en";

export function resolveUiLanguage(
  uiLanguage: UserSettings["uiLanguage"] | null | undefined,
): ResponseLanguage {
  return uiLanguage === "en" ? "en" : "ru";
}

function getResponseLanguageLabel(language: ResponseLanguage): string {
  return language === "en" ? "English" : "Russian";
}

export function buildResponseLanguageInstruction(
  uiLanguage: UserSettings["uiLanguage"] | null | undefined,
): string {
  const language = resolveUiLanguage(uiLanguage);
  const languageLabel = getResponseLanguageLabel(language);

  return [
    "# Response Language",
    `The user's selected interface language is "${language}" (${languageLabel}).`,
    `Write all user-facing prose in ${languageLabel} by default, even if the user writes in another language.`,
    "Keep code, API names, XML tag names, file paths, command names, and other technical identifiers unchanged.",
    "If the user explicitly requests another language for a specific reply, follow that explicit request.",
  ].join("\n");
}

export function appendResponseLanguageInstruction(
  basePrompt: string,
  uiLanguage: UserSettings["uiLanguage"] | null | undefined,
): string {
  const instruction = buildResponseLanguageInstruction(uiLanguage);
  return `${basePrompt.trim()}\n\n${instruction}`;
}
