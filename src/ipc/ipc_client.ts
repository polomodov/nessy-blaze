import {
  type ChatSummary,
  ChatSummariesSchema,
  type UserSettings,
  type ProposalResult,
} from "@/lib/schemas";
import type {
  App,
  AppOutput,
  ApproveProposalResult,
  Chat,
  ChatResponseEnd,
  ComponentSelection,
  CreateAppParams,
  CreateAppResult,
  CreateWorkspaceParams,
  FileAttachment,
  Message,
  RevertVersionParams,
  RevertVersionResponse,
  TenantOrganization,
  TenantWorkspace,
  Version,
} from "./ipc_types";
import {
  createBackendClientTransport,
  getConfiguredTenantScope,
  getConfiguredBackendBaseUrl,
  getDefaultRequestHeaders,
  type BackendClient as BackendClientTransport,
} from "./backend_client";
import { showError } from "@/lib/toast";

interface EncodedStreamAttachment {
  name: string;
  type: string;
  data: string;
  attachmentType: "upload-to-codebase" | "chat-context";
}

interface StreamMessageOptions {
  selectedComponents?: ComponentSelection[];
  chatId: number;
  redo?: boolean;
  attachments?: FileAttachment[];
  onUpdate: (messages: Message[]) => void;
  onEnd: (response: ChatResponseEnd) => void;
  onError: (error: string) => void;
}

function normalizeDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(0);
}

function parseSseEvent(
  rawEvent: string,
): { event: string; data: string } | null {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!eventName || dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join("\n"),
  };
}

function getBackendBaseUrlCandidates(): string[] {
  const candidates: string[] = [];
  const configuredBaseUrl = getConfiguredBackendBaseUrl();
  if (configuredBaseUrl) {
    candidates.push(configuredBaseUrl);
  }

  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    /^https?:\/\//i.test(window.location.origin)
  ) {
    const origin = window.location.origin.replace(/\/+$/, "");
    if (!candidates.includes(origin)) {
      candidates.push(origin);
    }
  }

  return candidates;
}

function isLikelyFetchFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror/i.test(message);
}

function formatChatStreamFetchError(
  error: unknown,
  attemptedUrls: string[],
): string {
  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  if (!isLikelyFetchFailure(error)) {
    return fallbackMessage;
  }

  const attempted = attemptedUrls.length > 0 ? attemptedUrls.join(", ") : "n/a";
  return `Unable to reach backend chat stream endpoint. Tried: ${attempted}. Verify backend URL config and that the local API server is running.`;
}

function extractPreviewUrls(value: unknown): {
  previewUrl: string;
  originalUrl: string;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const previewUrl =
    typeof record.previewUrl === "string" ? record.previewUrl : null;
  if (!previewUrl) {
    return null;
  }

  const originalUrl =
    typeof record.originalUrl === "string" ? record.originalUrl : previewUrl;
  return { previewUrl, originalUrl };
}

function normalizeChat(rawChat: Chat): Chat {
  const normalizedMessages = rawChat.messages.map((message) => ({
    ...message,
    createdAt: normalizeDate(message.createdAt),
  }));

  return {
    ...rawChat,
    messages: normalizedMessages,
  };
}

async function encodeAttachmentsForStream(
  attachments: FileAttachment[] | undefined,
): Promise<EncodedStreamAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const encoded = await Promise.all(
    attachments.map(async (attachment) => {
      const bytes = await attachment.file.arrayBuffer();
      const chunk = new Uint8Array(bytes);
      let binary = "";
      for (let index = 0; index < chunk.length; index += 1) {
        binary += String.fromCharCode(chunk[index]);
      }

      return {
        name: attachment.file.name,
        type: attachment.file.type,
        data: btoa(binary),
        attachmentType: attachment.type,
      } satisfies EncodedStreamAttachment;
    }),
  );

  return encoded;
}

export class IpcClient {
  private static instance: IpcClient;

  private readonly backend: BackendClientTransport;
  private readonly httpChatAbortControllers = new Map<
    number,
    AbortController
  >();
  private readonly globalChatStreamStartHandlers = new Set<
    (chatId: number) => void
  >();
  private readonly globalChatStreamEndHandlers = new Set<
    (chatId: number) => void
  >();
  private readonly telemetryEventHandlers = new Set<
    (payload: {
      eventName: string;
      properties?: Record<string, unknown>;
    }) => void
  >();

  private constructor(backend?: BackendClientTransport) {
    this.backend = backend ?? createBackendClientTransport();
  }

  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  public async listOrganizations(): Promise<TenantOrganization[]> {
    const data = await this.backend.invoke<unknown>("list-orgs");
    if (Array.isArray(data)) {
      return data as TenantOrganization[];
    }
    if (data && typeof data === "object") {
      const organizations = (data as { organizations?: unknown }).organizations;
      if (Array.isArray(organizations)) {
        return organizations as TenantOrganization[];
      }
    }
    return [];
  }

  public async listWorkspaces(params?: {
    orgId?: string;
  }): Promise<TenantWorkspace[]> {
    const data = await this.backend.invoke<unknown>(
      "list-workspaces",
      params ?? {},
    );
    if (Array.isArray(data)) {
      return data as TenantWorkspace[];
    }
    if (data && typeof data === "object") {
      const workspaces = (data as { workspaces?: unknown }).workspaces;
      if (Array.isArray(workspaces)) {
        return workspaces as TenantWorkspace[];
      }
    }
    return [];
  }

  public async createWorkspace(
    params: CreateWorkspaceParams,
  ): Promise<TenantWorkspace> {
    return this.backend.invoke("create-workspace", params);
  }

  public async listApps(): Promise<{ apps: App[] }> {
    const response = await this.backend.invoke<{ apps: App[] }>("list-apps");
    return {
      apps: (response.apps ?? []).map((app) => ({
        ...app,
        createdAt: normalizeDate(app.createdAt),
        updatedAt: normalizeDate(app.updatedAt),
      })),
    };
  }

  public async getApp(appId: number): Promise<App | null> {
    const app = await this.backend.invoke<App | null>("get-app", appId);
    if (!app) {
      return null;
    }
    return {
      ...app,
      createdAt: normalizeDate(app.createdAt),
      updatedAt: normalizeDate(app.updatedAt),
    };
  }

  public async createApp(params: CreateAppParams): Promise<CreateAppResult> {
    return this.backend.invoke("create-app", params);
  }

  public async getChats(appId?: number): Promise<ChatSummary[]> {
    const data = await this.backend.invoke<unknown>(
      "get-chats",
      typeof appId === "number" ? appId : undefined,
    );
    const chatArray = Array.isArray(data)
      ? data
      : data && typeof data === "object"
        ? ((data as { chats?: unknown[] }).chats ?? [])
        : [];
    return ChatSummariesSchema.parse(chatArray);
  }

  public async createChat(appId: number): Promise<number> {
    return this.backend.invoke("create-chat", appId);
  }

  public async getChat(chatId: number): Promise<Chat> {
    const chat = await this.backend.invoke<Chat>("get-chat", chatId);
    return normalizeChat(chat);
  }

  public async listVersions(params: { appId: number }): Promise<Version[]> {
    return this.backend.invoke("list-versions", params);
  }

  public async revertVersion(
    params: RevertVersionParams,
  ): Promise<RevertVersionResponse> {
    return this.backend.invoke("revert-version", params);
  }

  public async readAppFile(appId: number, filePath: string): Promise<string> {
    return this.backend.invoke("read-app-file", {
      appId,
      filePath,
    });
  }

  public async getProposal(chatId: number): Promise<ProposalResult | null> {
    return this.backend.invoke("get-proposal", { chatId });
  }

  public async approveProposal(params: {
    chatId: number;
    messageId: number;
  }): Promise<ApproveProposalResult> {
    return this.backend.invoke("approve-proposal", params);
  }

  public async rejectProposal(params: {
    chatId: number;
    messageId: number;
  }): Promise<void> {
    await this.backend.invoke("reject-proposal", params);
  }

  public async runApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
  ): Promise<void> {
    const result = await this.backend.invoke("run-app", { appId });
    const previewUrls = extractPreviewUrls(result);
    if (!previewUrls) {
      return;
    }
    onOutput({
      type: "stdout",
      message: `[blaze-proxy-server]started=[${previewUrls.previewUrl}] original=[${previewUrls.originalUrl}]`,
      appId,
      timestamp: Date.now(),
    });
  }

  public async stopApp(appId: number): Promise<void> {
    await this.backend.invoke("stop-app", { appId });
  }

  public async restartApp(
    appId: number,
    onOutput: (output: AppOutput) => void,
  ): Promise<void> {
    const result = await this.backend.invoke("restart-app", { appId });
    const previewUrls = extractPreviewUrls(result);
    if (!previewUrls) {
      return;
    }
    onOutput({
      type: "stdout",
      message: `[blaze-proxy-server]started=[${previewUrls.previewUrl}] original=[${previewUrls.originalUrl}]`,
      appId,
      timestamp: Date.now(),
    });
  }

  public async getUserSettings(): Promise<UserSettings> {
    return this.backend.invoke("get-user-settings");
  }

  public async setUserSettings(
    settings: Partial<UserSettings>,
  ): Promise<UserSettings> {
    return this.backend.invoke("set-user-settings", settings);
  }

  public async getEnvVars(): Promise<Record<string, string | undefined>> {
    return this.backend.invoke("get-env-vars");
  }

  public async getAppVersion(): Promise<string> {
    const response = await this.backend.invoke<{ version: string }>(
      "get-app-version",
    );
    return response.version;
  }

  public streamMessage(prompt: string, options: StreamMessageOptions): void {
    this.streamMessageOverHttp(prompt, options);
  }

  public cancelChatStream(chatId: number): void {
    const controller = this.httpChatAbortControllers.get(chatId);
    if (controller) {
      controller.abort();
      this.httpChatAbortControllers.delete(chatId);
    }

    const baseUrls = getBackendBaseUrlCandidates();
    if (baseUrls.length === 0) {
      return;
    }

    void (async () => {
      const scope = getConfiguredTenantScope();
      const path = `/api/v1/orgs/${encodeURIComponent(
        scope.orgId,
      )}/workspaces/${encodeURIComponent(
        scope.workspaceId,
      )}/chats/${chatId}/stream/cancel`;

      for (let index = 0; index < baseUrls.length; index += 1) {
        const baseUrl = baseUrls[index];
        const hasNextBaseUrl = index < baseUrls.length - 1;
        try {
          await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: getDefaultRequestHeaders("chat:cancel"),
          });
          return;
        } catch (error) {
          if (!hasNextBaseUrl || !isLikelyFetchFailure(error)) {
            return;
          }
        }
      }
    })();
  }

  public onChatStreamStart(handler: (chatId: number) => void): () => void {
    this.globalChatStreamStartHandlers.add(handler);
    return () => {
      this.globalChatStreamStartHandlers.delete(handler);
    };
  }

  public onChatStreamEnd(handler: (chatId: number) => void): () => void {
    this.globalChatStreamEndHandlers.add(handler);
    return () => {
      this.globalChatStreamEndHandlers.delete(handler);
    };
  }

  public onTelemetryEvent(
    handler: (payload: {
      eventName: string;
      properties?: Record<string, unknown>;
    }) => void,
  ): () => void {
    this.telemetryEventHandlers.add(handler);
    return () => {
      this.telemetryEventHandlers.delete(handler);
    };
  }

  private streamMessageOverHttp(
    prompt: string,
    options: StreamMessageOptions,
  ): void {
    const {
      chatId,
      redo,
      attachments,
      selectedComponents,
      onUpdate,
      onEnd,
      onError,
    } = options;

    for (const handler of this.globalChatStreamStartHandlers) {
      handler(chatId);
    }

    const abortController = new AbortController();
    this.httpChatAbortControllers.set(chatId, abortController);

    let settled = false;
    const settleWithEnd = (response: ChatResponseEnd) => {
      if (settled) return;
      settled = true;
      this.httpChatAbortControllers.delete(chatId);
      onEnd(response);
      for (const handler of this.globalChatStreamEndHandlers) {
        handler(chatId);
      }
    };

    const settleWithError = (errorMessage: string) => {
      if (settled) return;
      settled = true;
      this.httpChatAbortControllers.delete(chatId);
      onError(errorMessage);
      for (const handler of this.globalChatStreamEndHandlers) {
        handler(chatId);
      }
    };

    void (async () => {
      const attemptedStreamUrls: string[] = [];
      try {
        const encodedAttachments =
          await encodeAttachmentsForStream(attachments);
        const baseUrls = getBackendBaseUrlCandidates();
        if (baseUrls.length === 0) {
          throw new Error("Backend base URL is not configured.");
        }

        const scope = getConfiguredTenantScope();
        const path = `/api/v1/orgs/${encodeURIComponent(
          scope.orgId,
        )}/workspaces/${encodeURIComponent(
          scope.workspaceId,
        )}/chats/${chatId}/stream`;

        let response: Response | null = null;
        for (let index = 0; index < baseUrls.length; index += 1) {
          const baseUrl = baseUrls[index];
          const hasNextBaseUrl = index < baseUrls.length - 1;
          try {
            const streamUrl = `${baseUrl}${path}`;
            attemptedStreamUrls.push(streamUrl);
            response = await fetch(streamUrl, {
              method: "POST",
              headers: getDefaultRequestHeaders("chat:stream"),
              body: JSON.stringify({
                prompt,
                chatId,
                redo,
                selectedComponents,
                attachments: encodedAttachments,
              }),
              signal: abortController.signal,
            });
            break;
          } catch (error) {
            if (!hasNextBaseUrl || !isLikelyFetchFailure(error)) {
              throw error;
            }
          }
        }

        if (!response) {
          throw new Error("Streaming request failed.");
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `Backend stream failed with status ${response.status}${
              errorText ? `: ${errorText}` : ""
            }`,
          );
        }

        if (!response.body) {
          throw new Error("Streaming response body is empty.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder
            .decode(value, { stream: true })
            .replace(/\r\n/g, "\n");

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);
            separatorIndex = buffer.indexOf("\n\n");

            if (!rawEvent) {
              continue;
            }

            const parsedEvent = parseSseEvent(rawEvent);
            if (!parsedEvent) {
              continue;
            }

            let payload: unknown;
            try {
              payload = JSON.parse(parsedEvent.data);
            } catch {
              continue;
            }

            if (parsedEvent.event === "chat:response:chunk") {
              if (
                payload &&
                typeof payload === "object" &&
                Array.isArray((payload as { messages?: unknown[] }).messages)
              ) {
                onUpdate((payload as { messages: Message[] }).messages);
              }
              continue;
            }

            if (parsedEvent.event === "chat:response:error") {
              const errorMessage =
                payload &&
                typeof payload === "object" &&
                typeof (payload as { error?: unknown }).error === "string"
                  ? ((payload as { error: string }).error ?? "Unknown error")
                  : "Unknown streaming error.";
              settleWithError(errorMessage);
              return;
            }

            if (parsedEvent.event === "chat:response:end") {
              settleWithEnd(payload as ChatResponseEnd);
              return;
            }
          }
        }

        settleWithEnd({
          chatId,
          updatedFiles: false,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          settleWithEnd({
            chatId,
            updatedFiles: false,
          });
          return;
        }

        const errorMessage = formatChatStreamFetchError(
          error,
          attemptedStreamUrls,
        );
        showError(error);
        settleWithError(errorMessage);
      }
    })();
  }
}
