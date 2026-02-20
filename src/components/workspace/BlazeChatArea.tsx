import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Globe,
  Image,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  previewIframeRefAtom,
  selectedComponentsPreviewAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";
import { SelectedComponentsDisplay } from "../chat/SelectedComponentDisplay";
import { useI18n } from "@/contexts/I18nContext";
import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import type { Message as BackendMessage } from "@/ipc/ipc_types";
import type { ProposalResult } from "@/lib/schemas";
import type { TranslationParams } from "@/i18n/types";

type StatusBlock = {
  title: string;
  body: string;
};

type Message = {
  id: string;
  backendId?: number;
  content: string;
  role: "user" | "agent";
  isAssistantActionOnly?: boolean;
  statusBlocks?: StatusBlock[];
  sourceCommitHash?: string | null;
};

type PendingCodeProposal = {
  chatId: number;
  messageId: number;
  title: string;
  filesCount: number;
  packagesCount: number;
  sqlQueriesCount: number;
};

type TranslateFn = (key: string, params?: TranslationParams) => string;

function toPendingCodeProposal(
  proposalResult: ProposalResult | null,
): PendingCodeProposal | null {
  if (!proposalResult || proposalResult.proposal.type !== "code-proposal") {
    return null;
  }

  return {
    chatId: proposalResult.chatId,
    messageId: proposalResult.messageId,
    title: proposalResult.proposal.title,
    filesCount: proposalResult.proposal.filesChanged.length,
    packagesCount: proposalResult.proposal.packagesAdded.length,
    sqlQueriesCount: proposalResult.proposal.sqlQueries.length,
  };
}

function buildStarterPrompts(t: TranslateFn) {
  return [
    {
      icon: Globe,
      label: t("chat.starter.landing.label"),
      prompt: t("chat.starter.landing.prompt"),
    },
    {
      icon: Code2,
      label: t("chat.starter.update.label"),
      prompt: t("chat.starter.update.prompt"),
    },
    {
      icon: Image,
      label: t("chat.starter.banner.label"),
      prompt: t("chat.starter.banner.prompt"),
    },
    {
      icon: RotateCcw,
      label: t("chat.starter.redesign.label"),
      prompt: t("chat.starter.redesign.prompt"),
    },
  ];
}

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 120;

function findFirstUnclosedControlTagIndex(content: string): number {
  const tagPattern = /<(\/?)(blaze-[\w-]+|think)(?:\s[^>]*)?>/gi;
  const openStack: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content)) !== null) {
    const isClosing = match[1] === "/";
    const name = (match[2] || "").toLowerCase();
    const index = match.index;

    if (!isClosing) {
      openStack.push({ name, index });
      continue;
    }

    for (let i = openStack.length - 1; i >= 0; i--) {
      if (openStack[i].name === name) {
        openStack.splice(i, 1);
        break;
      }
    }
  }

  if (openStack.length === 0) {
    return -1;
  }

  return openStack.reduce(
    (minIndex, entry) => Math.min(minIndex, entry.index),
    Number.POSITIVE_INFINITY,
  );
}

function decodeXmlEntities(content: string): string {
  return content
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractStatusBlocks(
  content: string,
  defaultStatusTitle: string,
): {
  contentWithoutStatus: string;
  statusBlocks: StatusBlock[];
} {
  const statusBlocks: StatusBlock[] = [];
  const contentWithoutStatus = content.replace(
    /<blaze-status(?<attrs>\s[^>]*)?>(?<body>[\s\S]*?)<\/blaze-status>/gi,
    (_match, attrs = "", body = "", _offset, _string, groups) => {
      const attrsSource = (groups?.attrs as string | undefined) ?? attrs;
      const bodySource = (groups?.body as string | undefined) ?? body;
      const titleMatch = attrsSource.match(/\btitle="([^"]*)"/i);
      const title =
        decodeXmlEntities((titleMatch?.[1] ?? "").trim()) || defaultStatusTitle;
      const summaryBody = decodeXmlEntities(String(bodySource).trim());
      if (!summaryBody) {
        return "";
      }
      statusBlocks.push({
        title,
        body: summaryBody,
      });
      return "";
    },
  );
  return {
    contentWithoutStatus,
    statusBlocks,
  };
}

function stripControlMarkup(content: string): string {
  if (!content) {
    return "";
  }

  // Remove complete control blocks such as <blaze-write>...</blaze-write>.
  let cleaned = content;
  cleaned = cleaned.replace(
    /<(?<tag>blaze-[\w-]+|think)(?:\s[^>]*)?>[\s\S]*?<\/\k<tag>>/gi,
    "",
  );

  // If stream currently contains an unclosed control block, hide the full tail.
  const firstUnclosedTagIndex = findFirstUnclosedControlTagIndex(cleaned);
  if (firstUnclosedTagIndex >= 0) {
    cleaned = cleaned.slice(0, firstUnclosedTagIndex);
  }

  // Remove dangling opening/closing control tags in partial streams.
  cleaned = cleaned
    .replace(/<\/?(?:blaze-[\w-]+|think)(?:\s[^>]*)?>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function generateAppName(prompt: string): string {
  const baseName = prompt
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48)
    .trim();

  if (baseName.length > 0) {
    return `${baseName} ${Date.now()}`;
  }

  return `Blaze Project ${Date.now()}`;
}

function mapBackendMessages(
  messages: BackendMessage[],
  options: {
    assistantActionOnlyMessage: string;
    defaultStatusTitle: string;
  },
): Message[] {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => {
      const parsedBackendId = Number(message.id);
      const backendId = Number.isFinite(parsedBackendId)
        ? parsedBackendId
        : undefined;
      const isAssistant = message.role === "assistant";
      const rawContent = message.content ?? "";
      const { contentWithoutStatus, statusBlocks } = isAssistant
        ? extractStatusBlocks(rawContent, options.defaultStatusTitle)
        : { contentWithoutStatus: rawContent, statusBlocks: [] };
      const strippedContent = isAssistant
        ? stripControlMarkup(contentWithoutStatus)
        : "";
      const isAssistantActionOnly =
        isAssistant &&
        rawContent.trim().length > 0 &&
        strippedContent.length === 0 &&
        statusBlocks.length === 0;
      const content = isAssistant
        ? isAssistantActionOnly
          ? options.assistantActionOnlyMessage
          : strippedContent
        : message.content;
      const role: Message["role"] = isAssistant ? "agent" : "user";

      return {
        id: String(message.id),
        backendId,
        role,
        content,
        isAssistantActionOnly,
        statusBlocks,
        sourceCommitHash: message.sourceCommitHash ?? null,
      };
    })
    .filter(
      (message) =>
        message.role === "user" ||
        message.content.length > 0 ||
        (message.statusBlocks?.length ?? 0) > 0,
    );
}

function findPreviousUserBackendMessageId(
  mappedMessages: Message[],
  assistantMessageIndex: number,
): number | null {
  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = mappedMessages[index];
    if (message?.role !== "user") {
      continue;
    }

    if (typeof message.backendId === "number") {
      return message.backendId;
    }
  }

  return null;
}

function hasHiddenAssistantActivity(
  messages: BackendMessage[],
  defaultStatusTitle: string,
): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") {
      return false;
    }

    const rawContent = message.content ?? "";
    const { contentWithoutStatus, statusBlocks } = extractStatusBlocks(
      rawContent,
      defaultStatusTitle,
    );
    if (rawContent.trim().length === 0) {
      return false;
    }
    if (statusBlocks.length > 0) {
      return false;
    }

    return stripControlMarkup(contentWithoutStatus).length === 0;
  });
}

function resolveErrorMessage(error: unknown, fallbackMessage: string): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

interface BlazeChatAreaProps {
  activeAppId?: number | null;
  onAppCreated?: (appId: number) => void;
}

export function BlazeChatArea({
  activeAppId,
  onAppCreated,
}: BlazeChatAreaProps) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const starterPrompts = useMemo(() => buildStarterPrompts(t), [t]);
  const messageMapperOptions = useMemo(
    () => ({
      assistantActionOnlyMessage: t("chat.assistantActionOnly"),
      defaultStatusTitle: t("chat.diagnostic.defaultTitle"),
    }),
    [t],
  );
  const mapMessages = useCallback(
    (backendMessages: BackendMessage[]) =>
      mapBackendMessages(backendMessages, messageMapperOptions),
    [messageMapperOptions],
  );
  const hasHiddenActivity = useCallback(
    (backendMessages: BackendMessage[]) =>
      hasHiddenAssistantActivity(
        backendMessages,
        messageMapperOptions.defaultStatusTitle,
      ),
    [messageMapperOptions.defaultStatusTitle],
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [appId, setAppId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [revertingMessageId, setRevertingMessageId] = useState<string | null>(
    null,
  );
  const [isHiddenAgentActivity, setIsHiddenAgentActivity] = useState(false);
  const [pendingCodeProposal, setPendingCodeProposal] =
    useState<PendingCodeProposal | null>(null);
  const [expandedStatusKeys, setExpandedStatusKeys] = useState<Set<string>>(
    new Set(),
  );
  const [selectedComponents, setSelectedComponents] = useAtom(
    selectedComponentsPreviewAtom,
  );
  const previewIframeRef = useAtomValue(previewIframeRefAtom);
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const visibleChatIdRef = useRef<number | null>(null);
  const pendingStreamChatIdsRef = useRef<Set<number>>(new Set());

  const syncPendingCodeProposal = useCallback(
    async (targetChatId: number | null) => {
      if (!targetChatId || settings?.autoApproveChanges) {
        setPendingCodeProposal(null);
        return;
      }

      try {
        const proposalResult =
          await IpcClient.getInstance().getProposal(targetChatId);
        if (visibleChatIdRef.current !== targetChatId) {
          return;
        }
        setPendingCodeProposal(toPendingCodeProposal(proposalResult));
      } catch (proposalError) {
        if (visibleChatIdRef.current !== targetChatId) {
          return;
        }
        console.error("Failed to load pending proposal:", proposalError);
        setPendingCodeProposal(null);
      }
    },
    [settings?.autoApproveChanges],
  );

  useEffect(() => {
    visibleChatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    void syncPendingCodeProposal(chatId);
  }, [chatId, syncPendingCodeProposal]);

  useEffect(() => {
    if (typeof activeAppId === "undefined") {
      return;
    }
    setSelectedComponents([]);
    setVisualEditingSelectedComponent(null);
  }, [activeAppId, setSelectedComponents, setVisualEditingSelectedComponent]);

  const resizeInput = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const targetHeight = Math.min(
      MAX_INPUT_HEIGHT,
      Math.max(MIN_INPUT_HEIGHT, textarea.scrollHeight),
    );
    textarea.style.height = `${targetHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    resizeInput();
  }, [input, resizeInput]);

  useEffect(() => {
    if (typeof activeAppId === "undefined") {
      return;
    }

    let cancelled = false;

    const loadInteractionHistory = async () => {
      setError(null);

      if (activeAppId === null) {
        setAppId(null);
        setChatId(null);
        visibleChatIdRef.current = null;
        setMessages([]);
        setRevertingMessageId(null);
        setIsTyping(false);
        setIsHiddenAgentActivity(false);
        return;
      }

      setAppId(activeAppId);
      const chats = await IpcClient.getInstance().getChats(activeAppId);
      if (cancelled) {
        return;
      }

      if (chats.length === 0) {
        setChatId(null);
        setMessages([]);
        return;
      }

      const chatsByRecency = [...chats].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
      const fallbackLatestChat = chatsByRecency[0];
      if (!fallbackLatestChat) {
        setChatId(null);
        setMessages([]);
        return;
      }

      let selectedChatId: number | null = null;
      let selectedMessages: Message[] = [];
      let selectedHasHiddenAgentActivity = false;

      for (const chatSummary of chatsByRecency) {
        const chat = await IpcClient.getInstance().getChat(chatSummary.id);
        if (cancelled) {
          return;
        }

        const mappedMessages = mapMessages(chat.messages);
        if (mappedMessages.length > 0) {
          selectedChatId = chat.id;
          selectedMessages = mappedMessages;
          selectedHasHiddenAgentActivity = hasHiddenActivity(chat.messages);
          break;
        }
      }

      if (selectedChatId === null) {
        const latestChat = await IpcClient.getInstance().getChat(
          fallbackLatestChat.id,
        );
        if (cancelled) {
          return;
        }
        selectedChatId = latestChat.id;
        selectedMessages = mapMessages(latestChat.messages);
        selectedHasHiddenAgentActivity = hasHiddenActivity(latestChat.messages);
      }

      visibleChatIdRef.current = selectedChatId;
      setChatId(selectedChatId);
      setMessages(selectedMessages);
      setRevertingMessageId(null);
      const isSelectedChatPending =
        pendingStreamChatIdsRef.current.has(selectedChatId);
      setIsTyping(isSelectedChatPending);
      setIsHiddenAgentActivity(
        isSelectedChatPending ? selectedHasHiddenAgentActivity : false,
      );
    };

    void loadInteractionHistory().catch((historyError) => {
      if (cancelled) {
        return;
      }
      setError(resolveErrorMessage(historyError, t("chat.error.sendFailed")));
      setChatId(null);
      setMessages([]);
    });

    return () => {
      cancelled = true;
    };
  }, [activeAppId, hasHiddenActivity, mapMessages, t]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (isTyping) return;
    if (pendingCodeProposal && !settings?.autoApproveChanges) return;

    const prompt = input.trim();
    const selectedComponentsForPrompt =
      selectedComponents.length > 0 ? [...selectedComponents] : [];
    setError(null);

    const userMessage: Message = {
      id: String(Date.now()),
      role: "user",
      content: prompt,
    };

    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setIsTyping(true);
    setIsHiddenAgentActivity(false);
    setPendingCodeProposal(null);
    setSelectedComponents([]);
    setVisualEditingSelectedComponent(null);
    if (previewIframeRef?.contentWindow) {
      previewIframeRef.contentWindow.postMessage(
        { type: "clear-blaze-component-overlays" },
        "*",
      );
      previewIframeRef.contentWindow.postMessage(
        { type: "deactivate-blaze-component-selector" },
        "*",
      );
    }
    let activeChatId = chatId;
    let appIdForMessage = appId;

    try {
      if (activeChatId === null) {
        if (appIdForMessage !== null) {
          const createdChatId =
            await IpcClient.getInstance().createChat(appIdForMessage);
          activeChatId = createdChatId;
          visibleChatIdRef.current = createdChatId;
          setChatId(createdChatId);
        } else {
          const createAppResult = await IpcClient.getInstance().createApp({
            name: generateAppName(prompt),
          });
          activeChatId = createAppResult.chatId;
          appIdForMessage = createAppResult.app.id;
          visibleChatIdRef.current = createAppResult.chatId;
          setChatId(createAppResult.chatId);
          setAppId(createAppResult.app.id);
          onAppCreated?.(createAppResult.app.id);
        }
      }

      if (activeChatId === null) {
        throw new Error("Chat is not ready for streaming.");
      }

      const streamChatId = activeChatId;
      pendingStreamChatIdsRef.current.add(streamChatId);
      if (visibleChatIdRef.current === streamChatId) {
        setIsTyping(true);
      }

      IpcClient.getInstance().streamMessage(prompt, {
        chatId: streamChatId,
        selectedComponents: selectedComponentsForPrompt,
        onUpdate: (updatedMessages) => {
          if (visibleChatIdRef.current !== streamChatId) {
            return;
          }
          setMessages(mapMessages(updatedMessages));
          setIsHiddenAgentActivity(hasHiddenActivity(updatedMessages));
        },
        onEnd: () => {
          pendingStreamChatIdsRef.current.delete(streamChatId);
          if (visibleChatIdRef.current === streamChatId) {
            setIsTyping(false);
            setIsHiddenAgentActivity(false);
          }
          void syncPendingCodeProposal(streamChatId);
        },
        onError: (streamError) => {
          pendingStreamChatIdsRef.current.delete(streamChatId);
          if (visibleChatIdRef.current === streamChatId) {
            setError(streamError);
            setIsTyping(false);
            setIsHiddenAgentActivity(false);
          }
        },
      });
    } catch (sendError) {
      setError(resolveErrorMessage(sendError, t("chat.error.sendFailed")));
      setIsTyping(false);
    }
  };

  const handleApprovePendingChanges = async () => {
    if (!pendingCodeProposal || isTyping || isApproving) {
      return;
    }

    setIsApproving(true);
    setError(null);
    try {
      await IpcClient.getInstance().approveProposal({
        chatId: pendingCodeProposal.chatId,
        messageId: pendingCodeProposal.messageId,
      });
      const refreshedChat = await IpcClient.getInstance().getChat(
        pendingCodeProposal.chatId,
      );

      if (visibleChatIdRef.current === pendingCodeProposal.chatId) {
        setMessages(mapMessages(refreshedChat.messages));
        setIsHiddenAgentActivity(hasHiddenActivity(refreshedChat.messages));
      }
      await syncPendingCodeProposal(pendingCodeProposal.chatId);
    } catch (approveError) {
      setError(
        resolveErrorMessage(approveError, t("chat.error.approveFailed")),
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleRollbackMessage = async (
    assistantMessageId: string,
    assistantMessageIndex: number,
  ) => {
    if (isTyping || revertingMessageId) {
      return;
    }

    const assistantMessage = messages[assistantMessageIndex];
    if (
      !assistantMessage ||
      assistantMessage.role !== "agent" ||
      !assistantMessage.sourceCommitHash
    ) {
      return;
    }

    if (!appId || !chatId) {
      setError(t("chat.error.rollbackFailed"));
      return;
    }

    const previousUserMessageId = findPreviousUserBackendMessageId(
      messages,
      assistantMessageIndex,
    );

    setRevertingMessageId(assistantMessageId);
    setError(null);
    try {
      await IpcClient.getInstance().revertVersion({
        appId,
        previousVersionId: assistantMessage.sourceCommitHash,
        currentChatMessageId:
          previousUserMessageId === null
            ? undefined
            : {
                chatId,
                messageId: previousUserMessageId,
              },
      });

      const refreshedChat = await IpcClient.getInstance().getChat(chatId);
      if (visibleChatIdRef.current === chatId) {
        setMessages(mapMessages(refreshedChat.messages));
        setIsHiddenAgentActivity(hasHiddenActivity(refreshedChat.messages));
      }
      await syncPendingCodeProposal(chatId);
    } catch (revertError) {
      setError(
        resolveErrorMessage(revertError, t("chat.error.rollbackFailed")),
      );
    } finally {
      setRevertingMessageId(null);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0;
  const hasPendingManualProposal =
    !settings?.autoApproveChanges && pendingCodeProposal !== null;
  const toggleStatusKey = (key: string) => {
    setExpandedStatusKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-2xl text-center"
            >
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
                <Sparkles size={28} className="text-primary-foreground" />
              </div>
              <h2 className="mb-2 text-2xl font-bold text-foreground">
                {t("chat.empty.title")}
              </h2>
              <p className="mb-8 text-muted-foreground">
                {t("chat.empty.subtitle")}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {starterPrompts.map((item, index) => (
                  <motion.button
                    key={item.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + index * 0.1 }}
                    onClick={() => {
                      setInput(item.prompt);
                      inputRef.current?.focus();
                    }}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-foreground">
                      <item.icon size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.prompt}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <AnimatePresence>
              {messages.map((message, messageIndex) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-4 flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === "user"
                        ? "bg-user-bubble text-primary-foreground"
                        : message.isAssistantActionOnly
                          ? "border border-dashed border-primary/40 bg-primary/5 text-muted-foreground"
                          : "bg-agent-bubble text-foreground"
                    }`}
                  >
                    {message.content && <div>{message.content}</div>}
                    {message.statusBlocks?.map((statusBlock, index) => {
                      const statusKey = `${message.id}:status:${index}`;
                      const isExpanded = expandedStatusKeys.has(statusKey);
                      return (
                        <div
                          key={statusKey}
                          className={`${
                            message.content ? "mt-3" : ""
                          } rounded-lg border border-border bg-(--background-lightest)`}
                        >
                          <button
                            className="w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer"
                            onClick={() => toggleStatusKey(statusKey)}
                          >
                            <span className="font-medium text-xs">
                              {statusBlock.title}
                            </span>
                            {isExpanded ? (
                              <ChevronUp
                                size={16}
                                className="text-muted-foreground"
                              />
                            ) : (
                              <ChevronDown
                                size={16}
                                className="text-muted-foreground"
                              />
                            )}
                          </button>
                          {isExpanded && (
                            <pre className="px-3 pb-3 text-xs whitespace-pre-wrap break-words text-muted-foreground font-mono overflow-auto max-h-60">
                              {statusBlock.body}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                    {message.role === "agent" && message.sourceCommitHash && (
                      <div className="mt-3 border-t border-border/60 pt-2">
                        <button
                          type="button"
                          data-testid={`rollback-button-${message.id}`}
                          onClick={() => {
                            void handleRollbackMessage(
                              message.id,
                              messageIndex,
                            );
                          }}
                          disabled={Boolean(revertingMessageId) || isTyping}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCcw size={12} />
                          {revertingMessageId === message.id
                            ? t("chat.rollback.button.reverting")
                            : t("chat.rollback.button")}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-4 flex justify-start"
              >
                <div className="rounded-2xl bg-agent-bubble px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-pulse-dot rounded-full bg-muted-foreground" />
                    <span className="h-2 w-2 animate-pulse-dot rounded-full bg-muted-foreground [animation-delay:0.2s]" />
                    <span className="h-2 w-2 animate-pulse-dot rounded-full bg-muted-foreground [animation-delay:0.4s]" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {isHiddenAgentActivity
                      ? t("chat.typing.thinking")
                      : t("chat.typing.drafting")}
                  </p>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-4 py-4">
        {hasPendingManualProposal && pendingCodeProposal && (
          <div className="mx-auto mb-3 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {t("chat.manualApply.title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("chat.manualApply.summary", {
                  files: pendingCodeProposal.filesCount,
                  packages: pendingCodeProposal.packagesCount,
                  sqlQueries: pendingCodeProposal.sqlQueriesCount,
                })}
              </p>
            </div>
            <button
              type="button"
              data-testid="manual-approve-button"
              onClick={() => {
                void handleApprovePendingChanges();
              }}
              disabled={isApproving || isTyping}
              className="flex-shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApproving
                ? t("chat.manualApply.button.approving")
                : t("chat.manualApply.button.approve")}
            </button>
          </div>
        )}
        <div className="mx-auto max-w-2xl">
          <SelectedComponentsDisplay />
        </div>
        <div className="mx-auto flex max-w-2xl items-end gap-3">
          <div className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t("chat.input.placeholder")}
              rows={1}
              className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isTyping || hasPendingManualProposal}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:brightness-105 active:scale-95 disabled:opacity-40 disabled:hover:brightness-100"
          >
            <Send size={18} />
          </button>
        </div>
        {error && (
          <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-destructive">
            {error}
          </p>
        )}
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-muted-foreground">
          {t("chat.footer.hint")}
        </p>
      </div>
    </div>
  );
}
