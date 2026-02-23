import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "/src/paths/paths.ts";
import {
  UserSettingsSchema,
  type UserSettings,
  Secret,
  VertexProviderSetting,
} from "/src/lib/schemas.ts";
import { v4 as uuidv4 } from "uuid";
import { log } from "/src/lib/logger.ts";
import { DEFAULT_TEMPLATE_ID } from "/src/shared/templates.ts";
import { DEFAULT_THEME_ID } from "/src/shared/themes.ts";

const logger = log.scope("settings");

// IF YOU NEED TO UPDATE THIS, YOU'RE PROBABLY DOING SOMETHING WRONG!
// Need to maintain backwards compatibility!
const DEFAULT_SETTINGS: UserSettings = {
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: uuidv4(),
  hasRunBefore: false,
  enableProLazyEditsMode: true,
  enableProSmartFilesContextMode: true,
  selectedChatMode: "build",
  autoApproveChanges: true,
  enableAutoFixProblems: false,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  uiLanguage: "ru",
  // Enabled by default in 0.33.0-beta.1
  enableNativeGit: true,
};

const SETTINGS_FILE = "user-settings.json";

function normalizeChatModeForHttpOnly(value: unknown): "build" | "ask" {
  return value === "ask" ? "ask" : "build";
}

function normalizeLegacyChatModes(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...settings };
  if ("selectedChatMode" in normalized) {
    normalized.selectedChatMode = normalizeChatModeForHttpOnly(
      normalized.selectedChatMode,
    );
  }
  if (
    "defaultChatMode" in normalized &&
    normalized.defaultChatMode !== undefined
  ) {
    normalized.defaultChatMode = normalizeChatModeForHttpOnly(
      normalized.defaultChatMode,
    );
  }
  return normalized;
}

export function getSettingsFilePath(): string {
  return path.join(getUserDataPath(), SETTINGS_FILE);
}

export function readSettings(): UserSettings {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    const rawSettings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const combinedSettings = normalizeLegacyChatModes({
      ...DEFAULT_SETTINGS,
      ...rawSettings,
    }) as UserSettings;
    for (const provider in combinedSettings.providerSettings) {
      if (combinedSettings.providerSettings[provider].apiKey) {
        const encryptionType =
          combinedSettings.providerSettings[provider].apiKey.encryptionType;
        combinedSettings.providerSettings[provider].apiKey = {
          value: decrypt(combinedSettings.providerSettings[provider].apiKey),
          encryptionType,
        };
      }
      // Decrypt Vertex service account key if present
      const v = combinedSettings.providerSettings[
        provider
      ] as VertexProviderSetting;
      if (provider === "vertex" && v?.serviceAccountKey) {
        const encryptionType = v.serviceAccountKey.encryptionType;
        v.serviceAccountKey = {
          value: decrypt(v.serviceAccountKey),
          encryptionType,
        };
      }
    }

    // Validate and merge with defaults
    const validatedSettings = UserSettingsSchema.parse(combinedSettings);
    // "conservative" is deprecated, use undefined to use the default value
    if (validatedSettings.proSmartContextOption === "conservative") {
      validatedSettings.proSmartContextOption = undefined;
    }
    return validatedSettings;
  } catch (error) {
    logger.error("Error reading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Partial<UserSettings>): void {
  try {
    const filePath = getSettingsFilePath();
    const currentSettings = readSettings();
    const newSettings = normalizeLegacyChatModes({
      ...currentSettings,
      ...settings,
    }) as UserSettings;
    for (const provider in newSettings.providerSettings) {
      if (newSettings.providerSettings[provider].apiKey) {
        newSettings.providerSettings[provider].apiKey = encrypt(
          newSettings.providerSettings[provider].apiKey.value,
        );
      }
      // Encrypt Vertex service account key if present
      const v = newSettings.providerSettings[provider] as VertexProviderSetting;
      if (provider === "vertex" && v?.serviceAccountKey) {
        v.serviceAccountKey = encrypt(v.serviceAccountKey.value);
      }
    }
    const validatedSettings = UserSettingsSchema.parse(newSettings);
    fs.writeFileSync(filePath, JSON.stringify(validatedSettings, null, 2));
  } catch (error) {
    logger.error("Error writing settings:", error);
  }
}

export function encrypt(data: string): Secret {
  return {
    value: data,
    encryptionType: "plaintext",
  };
}

export function decrypt(data: Secret): string {
  return data.value;
}
