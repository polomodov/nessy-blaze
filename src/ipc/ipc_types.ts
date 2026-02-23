import { z } from "zod";
import type { ProblemReport, Problem } from "../../shared/tsc_types";
export type { ProblemReport, Problem };

export interface AppOutput {
  type: "stdout" | "stderr" | "info" | "client-error" | "input-requested";
  message: string;
  timestamp: number;
  appId: number;
}

export interface ConsoleEntry {
  level: "info" | "warn" | "error";
  type: "server" | "client" | "edge-function" | "network-requests";
  message: string;
  timestamp: number;
  sourceName?: string;
  appId: number;
}

export interface SecurityFinding {
  title: string;
  level: "critical" | "high" | "medium" | "low";
  description: string;
}

export interface SecurityReviewResult {
  findings: SecurityFinding[];
  timestamp: string;
  chatId: number;
}

export interface RespondToAppInputParams {
  appId: number;
  response: string;
}

export interface ListAppsResponse {
  apps: App[];
}

export interface ChatStreamParams {
  chatId: number;
  prompt: string;
  redo?: boolean;
  attachments?: Array<{
    name: string;
    type: string;
    data: string; // Base64 encoded file data
    attachmentType: "upload-to-codebase" | "chat-context"; // FileAttachment type
  }>;
  selectedComponents?: ComponentSelection[];
}

export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
  totalTokens?: number;
  contextWindow?: number;
}

export interface ChatProblemsEvent {
  chatId: number;
  appId: number;
  problems: ProblemReport;
}

export interface CreateAppParams {
  name: string;
}

export interface CreateAppResult {
  app: {
    id: number;
    organizationId?: string | null;
    workspaceId?: string | null;
    createdByUserId?: string | null;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  };
  chatId: number;
}

export interface Message {
  id: number;
  organizationId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
  role: "user" | "assistant";
  content: string;
  approvalState?: "approved" | "rejected" | null;
  commitHash?: string | null;
  sourceCommitHash?: string | null;
  createdAt?: Date | string;
  requestId?: string | null;
  totalTokens?: number | null;
  model?: string | null;
}

export interface Chat {
  id: number;
  appId?: number;
  organizationId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
  title: string;
  messages: Message[];
  initialCommitHash?: string | null;
}

export interface App {
  id: number;
  organizationId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
  installCommand: string | null;
  startCommand: string | null;
  isFavorite: boolean;
  resolvedPath?: string;
}

export interface AppFileSearchResult {
  path: string;
  matchesContent: boolean;
  snippets?: Array<{
    before: string;
    match: string;
    after: string;
    line: number;
  }>;
}

export interface Version {
  oid: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
  message: string;
  timestamp: number;
}

export type BranchResult = { branch: string };

export interface SandboxConfig {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  entry: string;
}

export interface NodeSystemInfo {
  nodeVersion: string | null;
  pnpmVersion: string | null;
  nodeDownloadUrl: string;
}

export interface SystemDebugInfo {
  nodeVersion: string | null;
  pnpmVersion: string | null;
  nodePath: string | null;
  telemetryId: string;
  telemetryConsent: string;
  telemetryUrl: string;
  blazeVersion: string;
  platform: string;
  architecture: string;
  logs: string;
  selectedLanguageModel: string;
}

export interface LocalModel {
  provider: "ollama" | "lmstudio";
  modelName: string; // Name used for API calls (e.g., "llama2:latest")
  displayName: string; // User-friendly name (e.g., "Llama 2")
}

export type LocalModelListResponse = {
  models: LocalModel[];
};

export interface TokenCountParams {
  chatId: number;
  input: string;
}

export interface TokenCountResult {
  estimatedTotalTokens: number;
  actualMaxTokens: number | null;
  messageHistoryTokens: number;
  codebaseTokens: number;
  mentionedAppsTokens: number;
  inputTokens: number;
  systemPromptTokens: number;
  contextWindow: number;
}

export interface ChatLogsData {
  debugInfo: SystemDebugInfo;
  chat: Chat;
  codebase: string;
}

export interface LanguageModelProvider {
  id: string;
  name: string;
  hasFreeTier?: boolean;
  websiteUrl?: string;
  gatewayPrefix?: string;
  secondary?: boolean;
  envVarName?: string;
  apiBaseUrl?: string;
  trustSelfSigned?: boolean;
  type: "custom" | "local" | "cloud";
}

export type LanguageModel =
  | {
      id: number;
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      tagColor?: string;
      maxOutputTokens?: number;
      contextWindow?: number;
      temperature?: number;
      dollarSigns?: number;
      type: "custom";
    }
  | {
      apiName: string;
      displayName: string;
      description: string;
      tag?: string;
      tagColor?: string;
      maxOutputTokens?: number;
      contextWindow?: number;
      temperature?: number;
      dollarSigns?: number;
      type: "local" | "cloud";
    };

export interface CreateCustomLanguageModelProviderParams {
  id: string;
  name: string;
  apiBaseUrl: string;
  envVarName?: string;
  trustSelfSigned?: boolean;
}

export interface CreateCustomLanguageModelParams {
  apiName: string;
  displayName: string;
  providerId: string;
  description?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
}

export interface DoesReleaseNoteExistParams {
  version: string;
}

export interface ApproveProposalResult {
  updatedFiles?: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
  selfHealAttempted?: boolean;
  selfHealRecovered?: boolean;
  selfHealAttempts?: number;
  selfHealErrors?: string[];
}

export interface ImportAppParams {
  path: string;
  appName: string;
  installCommand?: string;
  startCommand?: string;
  skipCopy?: boolean;
}

export interface CopyAppParams {
  appId: number;
  newAppName: string;
  withHistory: boolean;
}

export interface ImportAppResult {
  appId: number;
  chatId: number;
}

export interface RenameBranchParams {
  appId: number;
  oldBranchName: string;
  newBranchName: string;
}

// --- Git Branch Handler Types ---
export interface GitBranchAppIdParams {
  appId: number;
}

export interface CreateGitBranchParams {
  appId: number;
  branch: string;
  from?: string;
}

export interface GitBranchParams {
  appId: number;
  branch: string;
}

export interface RenameGitBranchParams {
  appId: number;
  oldBranch: string;
  newBranch: string;
}

export interface ListRemoteGitBranchesParams {
  appId: number;
  remote?: string;
}

export interface CommitChangesParams {
  appId: number;
  message: string;
}

export interface ChangeAppLocationParams {
  appId: number;
  parentDirectory: string;
}

export interface ChangeAppLocationResult {
  resolvedPath: string;
}

export const UserBudgetInfoSchema = z.object({
  usedCredits: z.number(),
  totalCredits: z.number(),
  budgetResetDate: z.date(),
  redactedUserId: z.string(),
});
export type UserBudgetInfo = z.infer<typeof UserBudgetInfoSchema>;

export interface ComponentSelection {
  id: string;
  name: string;
  runtimeId?: string; // Unique runtime ID for duplicate components
  tagName?: string;
  textPreview?: string;
  domPath?: string;
  relativePath: string;
  lineNumber: number;
  columnNumber: number;
}

export interface AppUpgrade {
  id: string;
  title: string;
  description: string;
  manualUpgradeUrl: string;
  isNeeded: boolean;
}

export interface EditAppFileReturnType {
  warning?: string;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface SetAppEnvVarsParams {
  appId: number;
  envVars: EnvVar[];
}

export interface GetAppEnvVarsParams {
  appId: number;
}

export interface UpdateChatParams {
  chatId: number;
  title: string;
}

export interface UploadFileToCodebaseParams {
  appId: number;
  filePath: string;
  fileData: string; // Base64 encoded file data
  fileName: string;
}

export interface UploadFileToCodebaseResult {
  success: boolean;
  filePath: string;
}

// --- Prompts ---
export interface PromptDto {
  id: number;
  title: string;
  description: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParamsDto {
  title: string;
  description?: string;
  content: string;
}

export interface UpdatePromptParamsDto extends CreatePromptParamsDto {
  id: number;
}

export interface FileAttachment {
  file: File;
  type: "upload-to-codebase" | "chat-context";
}

export interface RevertVersionParams {
  appId: number;
  previousVersionId: string;
  currentChatMessageId?: {
    chatId: number;
    messageId: number;
  };
}

export type RevertVersionResponse =
  | { successMessage: string }
  | { warningMessage: string };

export type MembershipRole = "owner" | "admin" | "member" | "viewer";

export interface TenantOrganization {
  id: string;
  slug: string;
  name: string;
  role: MembershipRole;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TenantWorkspace {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  type: "personal" | "team";
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateWorkspaceParams {
  orgId: string;
  name: string;
  slug?: string;
  type?: "personal" | "team";
}

export interface SetNodePathParams {
  nodePath: string;
}

export interface SelectNodeFolderResult {
  path: string | null;
  canceled?: boolean;
  selectedPath: string | null;
}

export interface VisualEditingChange {
  componentId: string;
  componentName: string;
  relativePath: string;
  lineNumber: number;
  styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };
    dimensions?: { width?: string; height?: string };
    border?: { width?: string; radius?: string; color?: string };
    backgroundColor?: string;
    text?: {
      fontSize?: string;
      fontWeight?: string;
      color?: string;
      fontFamily?: string;
    };
  };
  textContent?: string;
}

export interface ApplyVisualEditingChangesParams {
  appId: number;
  changes: VisualEditingChange[];
}

export interface AnalyseComponentParams {
  appId: number;
  componentId: string;
}

// ============================================================================
// Agent Todo Types
// ============================================================================

export interface AgentTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AgentTodosUpdatePayload {
  chatId: number;
  todos: AgentTodo[];
}

export interface AgentProblemsUpdatePayload {
  appId: number;
  problems: ProblemReport;
}

export interface TelemetryEventPayload {
  eventName: string;
  properties?: Record<string, unknown>;
}

// --- Theme Types ---
export interface SetAppThemeParams {
  appId: number;
  themeId: string | null;
}

export interface GetAppThemeParams {
  appId: number;
}

// --- Uncommitted Files Types ---
export type UncommittedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed";

export interface UncommittedFile {
  path: string;
  status: UncommittedFileStatus;
}
