import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Code2, Globe, Image, RotateCcw, Send, Sparkles } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import type { Message as BackendMessage } from "@/ipc/ipc_types";

type Message = {
  id: string;
  content: string;
  role: "user" | "agent";
  isAssistantActionOnly?: boolean;
};

const ASSISTANT_ACTION_ONLY_MESSAGE =
  "Assistant responded with internal actions.";

const starterPrompts = [
  {
    icon: Globe,
    label: "Landing page",
    prompt:
      "Build a promo landing page with a hero section, value props, and a lead form.",
  },
  {
    icon: Code2,
    label: "Update section",
    prompt:
      "Update the pricing section and add a new Premium plan at $29/month.",
  },
  {
    icon: Image,
    label: "Promo banner",
    prompt:
      "Create a high-contrast promo banner for 30% cashback with a yellow accent.",
  },
  {
    icon: RotateCcw,
    label: "Redesign",
    prompt:
      "Redesign the About page in a modern and minimalist style with clear typography.",
  },
];

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

function stripControlMarkup(content: string): string {
  if (!content) {
    return "";
  }

  // Remove complete control blocks such as <blaze-write>...</blaze-write>.
  let cleaned = content.replace(
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

function mapBackendMessages(messages: BackendMessage[]): Message[] {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => {
      const isAssistant = message.role === "assistant";
      const rawContent = message.content ?? "";
      const strippedContent = isAssistant ? stripControlMarkup(rawContent) : "";
      const isAssistantActionOnly =
        isAssistant &&
        rawContent.trim().length > 0 &&
        strippedContent.length === 0;
      const content = isAssistant
        ? isAssistantActionOnly
          ? ASSISTANT_ACTION_ONLY_MESSAGE
          : strippedContent
        : message.content;
      const role: Message["role"] = isAssistant ? "agent" : "user";

      return {
        id: String(message.id),
        role,
        content,
        isAssistantActionOnly,
      };
    })
    .filter((message) => message.role === "user" || message.content.length > 0);
}

function hasHiddenAssistantActivity(messages: BackendMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") {
      return false;
    }

    const rawContent = message.content ?? "";
    if (rawContent.trim().length === 0) {
      return false;
    }

    return stripControlMarkup(rawContent).length === 0;
  });
}

function resolveErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to send message. Please try again.";
}

interface BlazeChatAreaProps {
  activeAppId?: number | null;
  onAppCreated?: (appId: number) => void;
}

export function BlazeChatArea({
  activeAppId,
  onAppCreated,
}: BlazeChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [appId, setAppId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isHiddenAgentActivity, setIsHiddenAgentActivity] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const visibleChatIdRef = useRef<number | null>(null);
  const pendingStreamChatIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    visibleChatIdRef.current = chatId;
  }, [chatId]);

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

        const mappedMessages = mapBackendMessages(chat.messages);
        if (mappedMessages.length > 0) {
          selectedChatId = chat.id;
          selectedMessages = mappedMessages;
          selectedHasHiddenAgentActivity = hasHiddenAssistantActivity(
            chat.messages,
          );
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
        selectedMessages = mapBackendMessages(latestChat.messages);
        selectedHasHiddenAgentActivity = hasHiddenAssistantActivity(
          latestChat.messages,
        );
      }

      visibleChatIdRef.current = selectedChatId;
      setChatId(selectedChatId);
      setMessages(selectedMessages);
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
      setError(resolveErrorMessage(historyError));
      setChatId(null);
      setMessages([]);
    });

    return () => {
      cancelled = true;
    };
  }, [activeAppId]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (isTyping) return;

    const prompt = input.trim();
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
        onUpdate: (updatedMessages) => {
          if (visibleChatIdRef.current !== streamChatId) {
            return;
          }
          setMessages(mapBackendMessages(updatedMessages));
          setIsHiddenAgentActivity(hasHiddenAssistantActivity(updatedMessages));
        },
        onEnd: () => {
          pendingStreamChatIdsRef.current.delete(streamChatId);
          if (visibleChatIdRef.current === streamChatId) {
            setIsTyping(false);
            setIsHiddenAgentActivity(false);
          }
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
      setError(resolveErrorMessage(sendError));
      setIsTyping(false);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0;

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
                Nessy Blaze
              </h2>
              <p className="mb-8 text-muted-foreground">
                Describe the page you need, and the agent will draft it for you.
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
              {messages.map((message) => (
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
                    {message.content}
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
                      ? "Agent is thinking and applying changes..."
                      : "Agent is drafting a response..."}
                  </p>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-end gap-3">
          <div className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Describe what should be built..."
              rows={1}
              className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isTyping}
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
          The agent drafts pages based on your design system.
        </p>
      </div>
    </div>
  );
}
