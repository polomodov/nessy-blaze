import { describe, expect, it } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import type { LanguageModelProvider } from "@/ipc/ipc_types";
import {
  AUTO_MODELS,
  resolveAutoFallbackCandidates,
  resolveAutoModelCandidates,
} from "@/ipc/utils/get_model_client";

function createSettings(overrides?: Partial<UserSettings>): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    telemetryConsent: "unset",
    telemetryUserId: "test-user",
    hasRunBefore: false,
    experiments: {},
    enableProLazyEditsMode: true,
    enableProSmartFilesContextMode: true,
    selectedChatMode: "build",
    enableAutoFixProblems: false,
    enableAutoUpdate: true,
    releaseChannel: "stable",
    selectedTemplateId: "react",
    selectedThemeId: "default",
    isRunning: false,
    enableNativeGit: true,
    ...overrides,
  };
}

describe("resolveAutoModelCandidates", () => {
  const openRouterProvider: LanguageModelProvider = {
    id: "openrouter",
    name: "OpenRouter",
    type: "cloud",
    envVarName: "OPENROUTER_API_KEY",
  };

  it("returns the configured auto fallback order when OPENROUTER_API_KEY is set", () => {
    const settings = createSettings();
    const result = resolveAutoModelCandidates({
      settings,
      providers: [openRouterProvider],
      envLookup: (key) => (key === "OPENROUTER_API_KEY" ? "or-key" : undefined),
    });

    expect(result.map((item) => item.model)).toEqual(AUTO_MODELS);
    expect(result.map((item) => item.provider.id)).toEqual([
      "openrouter",
      "openrouter",
      "openrouter",
    ]);
  });

  it("uses provider key from settings when env key is not present", () => {
    const settings = createSettings({
      providerSettings: {
        openrouter: {
          apiKey: {
            value: "settings-key",
          },
        },
      },
    });

    const result = resolveAutoModelCandidates({
      settings,
      providers: [openRouterProvider],
      envLookup: () => undefined,
    });

    expect(result.map((item) => item.model.name)).toEqual([
      "deepseek/deepseek-r1-0528:free",
      "mistralai/mistral-small-3.2-24b-instruct:free",
      "openai/gpt-4o-mini",
    ]);
  });

  it("returns no candidates when provider key is missing", () => {
    const settings = createSettings();
    const result = resolveAutoModelCandidates({
      settings,
      providers: [openRouterProvider],
      envLookup: () => undefined,
    });

    expect(result).toEqual([]);
  });
});

describe("resolveAutoFallbackCandidates", () => {
  const openRouterProvider: LanguageModelProvider = {
    id: "openrouter",
    name: "OpenRouter",
    type: "cloud",
    envVarName: "OPENROUTER_API_KEY",
  };

  const lmStudioProvider: LanguageModelProvider = {
    id: "lmstudio",
    name: "LM Studio",
    type: "local",
  };

  it("prioritizes LM Studio model before cloud auto candidates", async () => {
    const settings = createSettings();

    const result = await resolveAutoFallbackCandidates({
      settings,
      providers: [lmStudioProvider, openRouterProvider],
      envLookup: (key) => (key === "OPENROUTER_API_KEY" ? "or-key" : undefined),
      getPreferredLmStudioModelName: async () => "qwen2.5-coder-7b-instruct",
    });

    expect(result[0]).toEqual({
      model: {
        provider: "lmstudio",
        name: "qwen2.5-coder-7b-instruct",
      },
      provider: lmStudioProvider,
    });
    expect(result.slice(1).map((item) => item.model)).toEqual(AUTO_MODELS);
  });

  it("uses cloud auto candidates when LM Studio is unavailable", async () => {
    const settings = createSettings();

    const result = await resolveAutoFallbackCandidates({
      settings,
      providers: [lmStudioProvider, openRouterProvider],
      envLookup: (key) => (key === "OPENROUTER_API_KEY" ? "or-key" : undefined),
      getPreferredLmStudioModelName: async () => null,
    });

    expect(result.map((item) => item.model)).toEqual(AUTO_MODELS);
  });
});
