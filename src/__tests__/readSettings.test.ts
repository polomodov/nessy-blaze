import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSettings, getSettingsFilePath } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { UserSettings } from "@/lib/schemas";

// Mock dependencies
vi.mock("node:fs");
vi.mock("node:path");
vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn(),
}));

const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);
const mockGetUserDataPath = vi.mocked(getUserDataPath);

describe("readSettings", () => {
  const mockUserDataPath = "/mock/user/data";
  const mockSettingsPath = "/mock/user/data/user-settings.json";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockReturnValue(mockSettingsPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when settings file does not exist", () => {
    it("should create default settings file and return default settings", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});

      const result = readSettings();

      expect(mockFs.existsSync).toHaveBeenCalledWith(mockSettingsPath);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        expect.stringContaining('"selectedModel"'),
      );
      expect(scrubSettings(result)).toMatchInlineSnapshot(`
        {
          "autoApproveChanges": true,
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableNativeGit": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "experiments": {},
          "hasRunBefore": false,
          "isRunning": false,
          "lastKnownPerformance": undefined,
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
          "selectedThemeId": "default",
          "telemetryConsent": "unset",
          "telemetryUserId": "[scrubbed]",
          "uiLanguage": "ru",
        }
      `);
    });
  });

  describe("when settings file exists", () => {
    it("should read and merge settings with defaults", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        hasRunBefore: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        "utf-8",
      );
      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.telemetryConsent).toBe("opted_in");
      expect(result.hasRunBefore).toBe(true);
      // Should still have defaults for missing properties
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
      expect(result.uiLanguage).toBe("ru");
    });

    it("preserves provider API keys when legacy encrypted settings are loaded", () => {
      const mockFileContent = {
        providerSettings: {
          openai: {
            apiKey: {
              value: "encrypted-api-key",
              encryptionType: "electron-safe-storage",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result.providerSettings.openai.apiKey).toEqual({
        value: "encrypted-api-key",
        encryptionType: "electron-safe-storage",
      });
    });

    it("drops github access token when legacy encrypted settings are loaded", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "encrypted-github-token",
          encryptionType: "electron-safe-storage",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect((result as Record<string, unknown>).githubAccessToken).toBe(
        undefined,
      );
    });

    it("drops supabase tokens when legacy encrypted settings are loaded", () => {
      const mockFileContent = {
        supabase: {
          accessToken: {
            value: "encrypted-access-token",
            encryptionType: "electron-safe-storage",
          },
          refreshToken: {
            value: "encrypted-refresh-token",
            encryptionType: "electron-safe-storage",
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect((result as Record<string, unknown>).supabase).toBe(undefined);
    });

    it("should ignore legacy plaintext secrets and keep provider keys", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "plaintext-token",
          encryptionType: "plaintext",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "plaintext-api-key",
              encryptionType: "plaintext",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect((result as Record<string, unknown>).githubAccessToken).toBe(
        undefined,
      );
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "plaintext-api-key",
      );
    });

    it("should ignore legacy secrets without encryptionType", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "token-without-encryption-type",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "api-key-without-encryption-type",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect((result as Record<string, unknown>).githubAccessToken).toBe(
        undefined,
      );
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "api-key-without-encryption-type",
      );
    });

    it("should strip extra fields not recognized by the schema", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        hasRunBefore: true,
        // Extra fields that are not in the schema (should be preserved)
        unknownField: "should be preserved",
        deprecatedSetting: true,
        extraConfig: {
          someValue: 123,
          anotherValue: "test",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        "utf-8",
      );
      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.telemetryConsent).toBe("opted_in");
      expect(result.hasRunBefore).toBe(true);

      // Extra fields should be stripped by the schema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultAny = result as any;
      expect(resultAny.unknownField).toBeUndefined();
      expect(resultAny.deprecatedSetting).toBeUndefined();
      expect(resultAny.extraConfig).toBeUndefined();

      // Should still have defaults for missing properties
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
    });
  });

  describe("error handling", () => {
    it("should return default settings when file read fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("File read error");
      });

      const result = readSettings();

      expect(scrubSettings(result)).toMatchInlineSnapshot(`
        {
          "autoApproveChanges": true,
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableNativeGit": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "experiments": {},
          "hasRunBefore": false,
          "isRunning": false,
          "lastKnownPerformance": undefined,
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
          "selectedThemeId": "default",
          "telemetryConsent": "unset",
          "telemetryUserId": "[scrubbed]",
          "uiLanguage": "ru",
        }
      `);
    });

    it("should return default settings when JSON parsing fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid json");

      const result = readSettings();

      expect(result).toMatchObject({
        selectedModel: {
          name: "auto",
          provider: "auto",
        },
        releaseChannel: "stable",
      });
    });

    it("should return default settings when schema validation fails", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          // Missing required 'provider' field
        },
        releaseChannel: "invalid-channel", // Invalid enum value
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result).toMatchObject({
        selectedModel: {
          name: "auto",
          provider: "auto",
        },
        releaseChannel: "stable",
      });
    });

    it("drops legacy encrypted payloads for removed integration fields", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "corrupted-encrypted-data",
          encryptionType: "electron-safe-storage",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect((result as Record<string, unknown>).githubAccessToken).toBe(
        undefined,
      );
    });
  });

  describe("getSettingsFilePath", () => {
    it("should return correct settings file path", () => {
      const result = getSettingsFilePath();

      expect(mockGetUserDataPath).toHaveBeenCalled();
      expect(mockPath.join).toHaveBeenCalledWith(
        mockUserDataPath,
        "user-settings.json",
      );
      expect(result).toBe(mockSettingsPath);
    });
  });
});

function scrubSettings(result: UserSettings) {
  return {
    ...result,
    telemetryUserId: "[scrubbed]",
  };
}
