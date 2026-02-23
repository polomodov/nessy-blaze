import { z } from "zod";

export const SecretSchema = z.object({
  value: z.string(),
  encryptionType: z.enum(["electron-safe-storage", "plaintext"]).optional(),
});
export type Secret = z.infer<typeof SecretSchema>;

/**
 * Zod schema for chat summary objects returned by the get-chats IPC
 */
export const ChatSummarySchema = z.object({
  id: z.number(),
  appId: z.number(),
  organizationId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  title: z.string().nullable(),
  createdAt: z.coerce.date(),
});

/**
 * Type derived from the ChatSummarySchema
 */
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/**
 * Zod schema for an array of chat summaries
 */
export const ChatSummariesSchema = z.array(ChatSummarySchema);

/**
 * Zod schema for chat search result objects returned by the search-chats IPC
 */
export const ChatSearchResultSchema = z.object({
  id: z.number(),
  appId: z.number(),
  organizationId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  title: z.string().nullable(),
  createdAt: z.coerce.date(),
  matchedMessageContent: z.string().nullable(),
});

/**
 * Type derived from the ChatSearchResultSchema
 */
export type ChatSearchResult = z.infer<typeof ChatSearchResultSchema>;

export const ChatSearchResultsSchema = z.array(ChatSearchResultSchema);

// Zod schema for app search result objects returned by the search-app IPC
export const AppSearchResultSchema = z.object({
  id: z.number(),
  organizationId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  name: z.string(),
  createdAt: z.coerce.date(),
  matchedChatTitle: z.string().nullable(),
  matchedChatMessage: z.string().nullable(),
});

// Type derived from AppSearchResultSchema
export type AppSearchResult = z.infer<typeof AppSearchResultSchema>;

export const AppSearchResultsSchema = z.array(AppSearchResultSchema);

const providers = [
  "openai",
  "anthropic",
  "google",
  "vertex",
  "auto",
  "openrouter",
  "ollama",
  "lmstudio",
  "azure",
  "xai",
  "bedrock",
] as const;

export const cloudProviders = providers.filter(
  (provider) => provider !== "ollama" && provider !== "lmstudio",
);

/**
 * Zod schema for large language model configuration
 */
export const LargeLanguageModelSchema = z.object({
  name: z.string(),
  provider: z.string(),
  customModelId: z.number().optional(),
});

/**
 * Type derived from the LargeLanguageModelSchema
 */
export type LargeLanguageModel = z.infer<typeof LargeLanguageModelSchema>;

/**
 * Zod schema for provider settings
 * Regular providers use only apiKey. Vertex has additional optional fields.
 */
export const RegularProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
});

export const AzureProviderSettingSchema = z.object({
  apiKey: SecretSchema.optional(),
  resourceName: z.string().optional(),
});

export const VertexProviderSettingSchema = z.object({
  // We make this undefined so that it makes existing callsites easier.
  apiKey: z.undefined(),
  projectId: z.string().optional(),
  location: z.string().optional(),
  serviceAccountKey: SecretSchema.optional(),
});

export const ProviderSettingSchema = z.union([
  // Must use more specific type first!
  // Zod uses the first type that matches.
  //
  // We use passthrough as a hack because Azure and Vertex
  // will match together since their required fields overlap.
  //
  // In addition, there may be future provider settings that
  // we may want to preserve (e.g. user downgrades to older version)
  // so doing passthrough keeps these extra fields.
  AzureProviderSettingSchema.passthrough(),
  VertexProviderSettingSchema.passthrough(),
  RegularProviderSettingSchema.passthrough(),
]);

/**
 * Type derived from the ProviderSettingSchema
 */
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;
export type RegularProviderSetting = z.infer<
  typeof RegularProviderSettingSchema
>;
export type AzureProviderSetting = z.infer<typeof AzureProviderSettingSchema>;
export type VertexProviderSetting = z.infer<typeof VertexProviderSettingSchema>;

export const ChatModeSchema = z.enum(["build", "ask"]);
export type ChatMode = z.infer<typeof ChatModeSchema>;

export const GlobPathSchema = z.object({
  globPath: z.string(),
});

export type GlobPath = z.infer<typeof GlobPathSchema>;

export const AppChatContextSchema = z.object({
  contextPaths: z.array(GlobPathSchema),
  smartContextAutoIncludes: z.array(GlobPathSchema),
  excludePaths: z.array(GlobPathSchema).optional(),
});
export type AppChatContext = z.infer<typeof AppChatContextSchema>;

export type ContextPathResult = GlobPath & {
  files: number;
  tokens: number;
};

export type ContextPathResults = {
  contextPaths: ContextPathResult[];
  smartContextAutoIncludes: ContextPathResult[];
  excludePaths: ContextPathResult[];
};

export const ReleaseChannelSchema = z.enum(["stable", "beta"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const ZoomLevelSchema = z.enum(["90", "100", "110", "125", "150"]);
export type ZoomLevel = z.infer<typeof ZoomLevelSchema>;

export const SmartContextModeSchema = z.enum([
  "balanced",
  "conservative",
  "deep",
]);
export type SmartContextMode = z.infer<typeof SmartContextModeSchema>;

export const AgentToolConsentSchema = z.enum(["ask", "always", "never"]);
export type AgentToolConsent = z.infer<typeof AgentToolConsentSchema>;

/**
 * Zod schema for user settings
 */
export const UserSettingsSchema = z.object({
  ////////////////////////////////
  // E2E TESTING ONLY.
  ////////////////////////////////
  isTestMode: z.boolean().optional(),

  ////////////////////////////////
  // ACTIVE FIELDS.
  ////////////////////////////////
  selectedModel: LargeLanguageModelSchema,
  providerSettings: z.record(z.string(), ProviderSettingSchema),
  agentToolConsents: z.record(z.string(), AgentToolConsentSchema).optional(),
  autoApproveChanges: z.boolean().optional(),
  telemetryConsent: z.enum(["opted_in", "opted_out", "unset"]).optional(),
  telemetryUserId: z.string().optional(),
  hasRunBefore: z.boolean().optional(),
  enableBlazePro: z.boolean().optional(),
  lastShownReleaseNotesVersion: z.string().optional(),
  maxChatTurnsInContext: z.number().optional(),
  thinkingBudget: z.enum(["low", "medium", "high"]).optional(),
  enableProLazyEditsMode: z.boolean().optional(),
  proLazyEditsMode: z.enum(["off", "v1", "v2"]).optional(),
  enableProSmartFilesContextMode: z.boolean().optional(),
  enableProWebSearch: z.boolean().optional(),
  proSmartContextOption: SmartContextModeSchema.optional(),
  selectedTemplateId: z.string(),
  selectedThemeId: z.string().optional(),
  uiLanguage: z.enum(["ru", "en"]).optional(),
  selectedChatMode: ChatModeSchema.optional(),
  defaultChatMode: ChatModeSchema.optional(),
  acceptedCommunityCode: z.boolean().optional(),
  zoomLevel: ZoomLevelSchema.optional(),

  enableAutoFixProblems: z.boolean().optional(),
  enableNativeGit: z.boolean().optional(),
  enableAutoUpdate: z.boolean(),
  releaseChannel: ReleaseChannelSchema,
  customNodePath: z.string().optional().nullable(),
  isRunning: z.boolean().optional(),
  lastKnownPerformance: z
    .object({
      timestamp: z.number(),
      memoryUsageMB: z.number(),
      cpuUsagePercent: z.number().optional(),
      systemMemoryUsageMB: z.number().optional(),
      systemMemoryTotalMB: z.number().optional(),
      systemCpuPercent: z.number().optional(),
    })
    .optional(),
  hideLocalAgentNewChatToast: z.boolean().optional(),
});

/**
 * Type derived from the UserSettingsSchema
 */
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export function isBlazeProEnabled(settings: UserSettings): boolean {
  return settings.enableBlazePro === true && hasBlazeProKey(settings);
}

export function hasBlazeProKey(settings: UserSettings): boolean {
  return !!settings.providerSettings?.auto?.apiKey?.value;
}

/**
 * Gets the effective default chat mode for the HTTP-only client-server runtime.
 * Only "build" and "ask" are surfaced in UI; legacy values are normalized.
 */
export function getEffectiveDefaultChatMode(settings: UserSettings): ChatMode {
  if (settings.defaultChatMode === "ask") {
    return "ask";
  }
  return "build";
}

export function isTurboEditsV2Enabled(settings: UserSettings): boolean {
  return Boolean(
    isBlazeProEnabled(settings) &&
      settings.enableProLazyEditsMode === true &&
      settings.proLazyEditsMode === "v2",
  );
}

// Define interfaces for the props
export interface SecurityRisk {
  type: "warning" | "danger";
  title: string;
  description: string;
}

export interface FileChange {
  name: string;
  path: string;
  summary: string;
  type: "write" | "rename" | "delete";
}

export interface CodeProposal {
  type: "code-proposal";
  title: string;
  securityRisks: SecurityRisk[];
  filesChanged: FileChange[];
  packagesAdded: string[];
}

export interface ProposalResult {
  proposal: CodeProposal;
  chatId: number;
  messageId: number;
}
