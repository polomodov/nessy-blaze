import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import log from "electron-log";
import { getExtraProviderOptions } from "./thinking_utils";
import type { UserSettings } from "../../lib/schemas";
import type { LanguageModel } from "ai";

const logger = log.scope("llm_engine_provider");

export type ExampleChatModelId = string & {};
export interface ChatParams {
  providerId: string;
}
export interface ExampleProviderSettings {
  /**
Example API key.
*/
  apiKey?: string;
  /**
Base URL for the API calls.
*/
  baseURL?: string;
  /**
Custom headers to include in the requests.
*/
  headers?: Record<string, string>;
  /**
Optional custom url query parameters to include in request urls.
*/
  queryParams?: Record<string, string>;
  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
*/
  fetch?: FetchFunction;

  blazeOptions: {
    enableLazyEdits?: boolean;
    enableSmartFilesContext?: boolean;
    enableWebSearch?: boolean;
  };
  settings: UserSettings;
}

export interface BlazeEngineProvider {
  /**
Creates a model for text generation.
*/
  (modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  /**
Creates a chat model for text generation.
*/
  chatModel(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  responses(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;
}

export function createBlazeEngine(
  options: ExampleProviderSettings,
): BlazeEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.info("creating blaze engine with baseURL", baseURL);

  // Track request ID attempts
  const requestIdAttempts = new Map<string, number>();

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "BLAZE_PRO_API_KEY",
      description: "Example API key",
    })}`,
    ...options.headers,
  });

  interface CommonModelConfig {
    provider: string;
    url: ({ path }: { path: string }) => string;
    headers: () => Record<string, string>;
    fetch?: FetchFunction;
  }

  const getCommonModelConfig = (): CommonModelConfig => ({
    provider: `blaze-engine`,
    url: ({ path }) => {
      const url = new URL(`${baseURL}${path}`);
      if (options.queryParams) {
        url.search = new URLSearchParams(options.queryParams).toString();
      }
      return url.toString();
    },
    headers: getHeaders,
    fetch: options.fetch,
  });

  // Custom fetch implementation that adds blaze-specific options to the request
  const createBlazeFetch = ({
    providerId,
  }: {
    providerId: string;
  }): FetchFunction => {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      // Use default fetch if no init or body
      if (!init || !init.body || typeof init.body !== "string") {
        return (options.fetch || fetch)(input, init);
      }

      try {
        // Parse the request body to manipulate it
        const parsedBody = {
          ...JSON.parse(init.body),
          ...getExtraProviderOptions(providerId, options.settings),
        };
        const blazeVersionedFiles = parsedBody.blazeVersionedFiles;
        if ("blazeVersionedFiles" in parsedBody) {
          delete parsedBody.blazeVersionedFiles;
        }
        const blazeFiles = parsedBody.blazeFiles;
        if ("blazeFiles" in parsedBody) {
          delete parsedBody.blazeFiles;
        }
        const requestId = parsedBody.blazeRequestId;
        if ("blazeRequestId" in parsedBody) {
          delete parsedBody.blazeRequestId;
        }
        const blazeAppId = parsedBody.blazeAppId;
        if ("blazeAppId" in parsedBody) {
          delete parsedBody.blazeAppId;
        }
        const blazeDisableFiles = parsedBody.blazeDisableFiles;
        if ("blazeDisableFiles" in parsedBody) {
          delete parsedBody.blazeDisableFiles;
        }
        const blazeMentionedApps = parsedBody.blazeMentionedApps;
        if ("blazeMentionedApps" in parsedBody) {
          delete parsedBody.blazeMentionedApps;
        }
        const blazeSmartContextMode = parsedBody.blazeSmartContextMode;
        if ("blazeSmartContextMode" in parsedBody) {
          delete parsedBody.blazeSmartContextMode;
        }

        // Track and modify requestId with attempt number
        let modifiedRequestId = requestId;
        if (requestId) {
          const currentAttempt = (requestIdAttempts.get(requestId) || 0) + 1;
          requestIdAttempts.set(requestId, currentAttempt);
          modifiedRequestId = `${requestId}:attempt-${currentAttempt}`;
        }

        // Add files to the request if they exist
        if (!blazeDisableFiles) {
          parsedBody.blaze_options = {
            files: blazeFiles,
            versioned_files: blazeVersionedFiles,
            enable_lazy_edits: options.blazeOptions.enableLazyEdits,
            enable_smart_files_context:
              options.blazeOptions.enableSmartFilesContext,
            smart_context_mode: blazeSmartContextMode,
            enable_web_search: options.blazeOptions.enableWebSearch,
            app_id: blazeAppId,
          };
          if (blazeMentionedApps?.length) {
            parsedBody.blaze_options.mentioned_apps = blazeMentionedApps;
          }
        }

        // Return modified request with files included and requestId in headers
        const modifiedInit = {
          ...init,
          headers: {
            ...init.headers,
            ...(modifiedRequestId && {
              "X-Blaze-Request-Id": modifiedRequestId,
            }),
          },
          body: JSON.stringify(parsedBody),
        };

        // Use the provided fetch or default fetch
        return (options.fetch || fetch)(input, modifiedInit);
      } catch (e) {
        logger.error("Error parsing request body", e);
        // If parsing fails, use original request
        return (options.fetch || fetch)(input, init);
      }
    };
  };

  const createChatModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createBlazeFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAICompatibleChatLanguageModel(modelId, config);
  };

  const createResponsesModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createBlazeFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAIResponsesLanguageModel(modelId, config);
  };

  const provider = (modelId: ExampleChatModelId, chatParams: ChatParams) =>
    createChatModel(modelId, chatParams);

  provider.chatModel = createChatModel;
  provider.responses = createResponsesModel;

  return provider;
}
