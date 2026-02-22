import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import { getThemePrompt } from "../../shared/themes";
import { getBlazeAppPath } from "../../paths/paths";
import log from "electron-log";
import { extractCodebase } from "../../utils/codebase";

import { TokenCountParams } from "../ipc_types";
import { TokenCountResult } from "../ipc_types";
import { estimateTokens, getContextWindow } from "../utils/token_utils";
import { createLoggedHandler } from "./safe_handle";
import { validateChatContext } from "../utils/context_paths_utils";
import { readSettings } from "@/main/settings";
import { extractMentionedAppsCodebases } from "../utils/mention_apps";
import { parseAppMentions } from "@/shared/parse_mention_apps";
import { isTurboEditsV2Enabled } from "@/lib/schemas";
import { appendResponseLanguageInstruction } from "../utils/response_language_prompt";

const logger = log.scope("token_count_handlers");

const handle = createLoggedHandler(logger);

export function registerTokenCountHandlers() {
  handle(
    "chat:count-tokens",
    async (event, req: TokenCountParams): Promise<TokenCountResult> => {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true,
        },
      });

      if (!chat) {
        throw new Error(`Chat not found: ${req.chatId}`);
      }

      // Prepare message history for token counting
      const messageHistory = chat.messages
        .map((message) => message.content)
        .join("");
      const messageHistoryTokens = estimateTokens(messageHistory);

      // Count input tokens
      const inputTokens = estimateTokens(req.input);

      const settings = readSettings();
      const selectedChatMode =
        settings.selectedChatMode === "ask" ? "ask" : "build";

      // Parse app mentions from the input
      const mentionedAppNames = parseAppMentions(req.input);

      // Count system prompt tokens
      const themePrompt = getThemePrompt(chat.app?.themeId ?? null);
      let systemPrompt = constructSystemPrompt({
        aiRules: await readAiRules(getBlazeAppPath(chat.app.path)),
        chatMode: selectedChatMode,
        enableTurboEditsV2: isTurboEditsV2Enabled(settings),
        themePrompt,
      });

      const localizedSystemPrompt = appendResponseLanguageInstruction(
        systemPrompt,
        settings.uiLanguage,
      );
      const systemPromptTokens = estimateTokens(localizedSystemPrompt);

      // Extract codebase information if app is associated with the chat
      let codebaseInfo = "";
      let codebaseTokens = 0;

      if (chat.app) {
        const appPath = getBlazeAppPath(chat.app.path);
        const { formattedOutput, files } = await extractCodebase({
          appPath,
          chatContext: validateChatContext(chat.app.chatContext),
        });
        codebaseInfo = formattedOutput;
        if (
          settings.enableBlazePro &&
          settings.enableProSmartFilesContextMode
        ) {
          codebaseTokens = estimateTokens(
            files
              // It doesn't need to be the exact format but it's just to get a token estimate
              .map(
                (file) =>
                  `<blaze-file=${file.path}>${file.content}</blaze-file>`,
              )
              .join("\n\n"),
          );
        } else {
          codebaseTokens = estimateTokens(codebaseInfo);
        }
        logger.log(
          `Extracted codebase information from ${appPath}, tokens: ${codebaseTokens}`,
        );
      }

      // Extract codebases for mentioned apps
      const mentionedAppsCodebases = await extractMentionedAppsCodebases(
        mentionedAppNames,
        chat.app?.id, // Exclude current app
      );

      // Calculate tokens for mentioned apps
      let mentionedAppsTokens = 0;
      if (mentionedAppsCodebases.length > 0) {
        const mentionedAppsContent = mentionedAppsCodebases
          .map(
            ({ appName, codebaseInfo }) =>
              `\n\n=== Referenced App: ${appName} ===\n${codebaseInfo}`,
          )
          .join("");

        mentionedAppsTokens = estimateTokens(mentionedAppsContent);

        logger.log(
          `Extracted ${mentionedAppsCodebases.length} mentioned app codebases, tokens: ${mentionedAppsTokens}`,
        );
      }

      // Calculate total tokens
      const totalTokens =
        messageHistoryTokens +
        inputTokens +
        systemPromptTokens +
        codebaseTokens +
        mentionedAppsTokens;

      // Find the last assistant message since totalTokens is only set on assistant messages
      const lastAssistantMessage = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const actualMaxTokens = lastAssistantMessage?.maxTokensUsed ?? null;

      return {
        estimatedTotalTokens: totalTokens,
        actualMaxTokens,
        messageHistoryTokens,
        codebaseTokens,
        mentionedAppsTokens,
        inputTokens,
        systemPromptTokens,
        contextWindow: await getContextWindow(),
      };
    },
  );
}
