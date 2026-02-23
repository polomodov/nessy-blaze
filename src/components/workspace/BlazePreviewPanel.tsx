import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Cloud,
  Code,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Monitor,
  MousePointerClick,
  Palette,
  RefreshCw,
  Shield,
  Smartphone,
  Tablet,
  Zap,
  Sparkles,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  previewIframeRefAtom,
  selectedComponentsPreviewAtom,
} from "@/atoms/previewAtoms";
import { appConsoleEntriesAtom, userSettingsAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useI18n } from "@/contexts/I18nContext";
import { IpcClient } from "@/ipc/ipc_client";
import type { AppOutput, ComponentSelection } from "@/ipc/ipc_types";
import { normalizePath } from "../../../shared/normalizePath";
import {
  buildPreviewUrl,
  extractPreviewPathsFromAppSource,
  getPreviewPathLabel,
} from "./preview_routes";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { AutoFixIncident } from "@/components/preview_panel/error_autofix_prompt";
import { useErrorAutofix } from "@/components/preview_panel/use_error_autofix";
import { computeFingerprint } from "@/components/preview_panel/error_autofix_policy";
import { showError } from "@/lib/toast";
import {
  WORKSPACE_AUTOFIX_STARTED_EVENT,
  WORKSPACE_AUTOFIX_COMPLETED_EVENT,
  type WorkspaceAutofixCompletedDetail,
  type WorkspaceAutofixStartedDetail,
  WORKSPACE_PREVIEW_REFRESH_EVENT,
  type WorkspacePreviewRefreshDetail,
} from "./autofix_events";

type Device = "desktop" | "tablet" | "mobile";
type RightPanelTabId =
  | "preview"
  | "cloud"
  | "design"
  | "code"
  | "analytics"
  | "security"
  | "speed";

const RIGHT_PANEL_TABS: ReadonlyArray<{
  id: RightPanelTabId;
  labelKey:
    | "preview.tab.preview"
    | "preview.tab.cloud"
    | "preview.tab.design"
    | "preview.tab.code"
    | "preview.tab.analytics"
    | "preview.tab.security"
    | "preview.tab.speed";
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "preview", labelKey: "preview.tab.preview", icon: Eye },
  { id: "cloud", labelKey: "preview.tab.cloud", icon: Cloud },
  { id: "design", labelKey: "preview.tab.design", icon: Palette },
  { id: "code", labelKey: "preview.tab.code", icon: Code },
  { id: "analytics", labelKey: "preview.tab.analytics", icon: BarChart3 },
  { id: "security", labelKey: "preview.tab.security", icon: Shield },
  { id: "speed", labelKey: "preview.tab.speed", icon: Zap },
];

const previewWidthByDevice: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

function extractProxyUrl(output: AppOutput): string | null {
  if (!output.message.includes("[blaze-proxy-server]started=[")) {
    return null;
  }

  const proxyUrlMatch = output.message.match(
    /\[blaze-proxy-server\]started=\[(.*?)\]/,
  );
  return proxyUrlMatch?.[1] ?? null;
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

function parseComponentSelection(data: unknown): ComponentSelection | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    type?: string;
    component?: {
      id?: string;
      name?: string;
      runtimeId?: string;
      tagName?: string;
      textPreview?: string;
      domPath?: string;
    };
  };

  if (payload.type !== "blaze-component-selected") {
    return null;
  }

  const component = payload.component;
  if (!component || typeof component.id !== "string") {
    return null;
  }

  const parts = component.id.split(":");
  if (parts.length < 3) {
    return null;
  }

  const columnPart = parts.pop();
  const linePart = parts.pop();
  const relativePath = parts.join(":");

  if (!columnPart || !linePart || !relativePath) {
    return null;
  }

  const lineNumber = Number.parseInt(linePart, 10);
  const columnNumber = Number.parseInt(columnPart, 10);

  if (Number.isNaN(lineNumber) || Number.isNaN(columnNumber)) {
    return null;
  }

  const normalizedTagName =
    typeof component.tagName === "string" && component.tagName.trim().length > 0
      ? component.tagName.trim().toLowerCase()
      : null;
  const normalizedTextPreview =
    typeof component.textPreview === "string" &&
    component.textPreview.trim().length > 0
      ? component.textPreview.trim()
      : null;
  const normalizedDomPath =
    typeof component.domPath === "string" && component.domPath.trim().length > 0
      ? component.domPath.trim()
      : null;

  return {
    id: component.id,
    name:
      typeof component.name === "string" && component.name.trim().length > 0
        ? component.name
        : "component",
    runtimeId: component.runtimeId,
    ...(normalizedTagName ? { tagName: normalizedTagName } : {}),
    ...(normalizedTextPreview ? { textPreview: normalizedTextPreview } : {}),
    ...(normalizedDomPath ? { domPath: normalizedDomPath } : {}),
    relativePath: normalizePath(relativePath),
    lineNumber,
    columnNumber,
  };
}

interface BlazePreviewPanelProps {
  activeAppId: number | null;
}

export function BlazePreviewPanel({ activeAppId }: BlazePreviewPanelProps) {
  const { t } = useI18n();
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [resolvedChatId, setResolvedChatId] = useState<number | null>(
    selectedChatId ?? null,
  );
  const consoleEntries = useAtomValue(appConsoleEntriesAtom);
  const settings = useAtomValue(userSettingsAtom);
  const { streamMessage, isStreaming } = useStreamChat({ hasChatId: false });
  const [device, setDevice] = useState<Device>("desktop");
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [previewPaths, setPreviewPaths] = useState<string[]>(["/"]);
  const [selectedPath, setSelectedPath] = useState("/");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupErrorIncident, setStartupErrorIncident] =
    useState<AutoFixIncident | null>(null);
  const [runtimeErrorIncident, setRuntimeErrorIncident] =
    useState<AutoFixIncident | null>(null);
  const [isPreparingAutoFixChat, setIsPreparingAutoFixChat] = useState(false);
  const [autoFixInFlightChatId, setAutoFixInFlightChatId] = useState<
    number | null
  >(null);
  const [activeTab, setActiveTab] = useState<RightPanelTabId>("preview");
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const [iframeRefreshToken, setIframeRefreshToken] = useState(0);
  const [isPickingComponent, setIsPickingComponent] = useState(false);
  const [selectableCount, setSelectableCount] = useState<number | null>(null);
  const [selectedComponents, setSelectedComponents] = useAtom(
    selectedComponentsPreviewAtom,
  );
  const setPreviewIframeRef = useSetAtom(previewIframeRefAtom);
  const setConsoleEntries = useSetAtom(appConsoleEntriesAtom);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const runningAppIdRef = useRef<number | null>(null);
  const { triggerAIFix } = useErrorAutofix({
    selectedAppId: activeAppId,
    selectedChatId: resolvedChatId,
    settings,
    isStreaming,
    consoleEntries,
    streamMessage,
  });

  const ensureChatIdForAutoFix = useCallback(async (): Promise<
    number | null
  > => {
    if (resolvedChatId) {
      return resolvedChatId;
    }

    if (activeAppId === null) {
      return null;
    }

    setIsPreparingAutoFixChat(true);
    try {
      const chats = await IpcClient.getInstance().getChats(activeAppId);
      const latestChat = [...chats].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];
      if (latestChat?.id) {
        setResolvedChatId(latestChat.id);
        return latestChat.id;
      }

      const createdChatId =
        await IpcClient.getInstance().createChat(activeAppId);
      setResolvedChatId(createdChatId);
      return createdChatId;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      setIsPreparingAutoFixChat(false);
    }
  }, [activeAppId, resolvedChatId]);

  useEffect(() => {
    if (selectedChatId) {
      setResolvedChatId(selectedChatId);
      return;
    }

    if (activeAppId === null) {
      setResolvedChatId(null);
      return;
    }

    let cancelled = false;
    void IpcClient.getInstance()
      .getChats(activeAppId)
      .then((chats) => {
        if (cancelled) {
          return;
        }
        if (chats.length === 0) {
          setResolvedChatId(null);
          return;
        }
        const latestChat = [...chats].sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )[0];
        setResolvedChatId(latestChat?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedChatId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeAppId, selectedChatId]);

  useEffect(() => {
    const unsubscribe = IpcClient.getInstance().onChatStreamEnd((chatId) => {
      if (autoFixInFlightChatId === null || chatId !== autoFixInFlightChatId) {
        return;
      }
      setAutoFixInFlightChatId(null);
      const detail: WorkspaceAutofixCompletedDetail = { chatId };
      window.dispatchEvent(
        new CustomEvent<WorkspaceAutofixCompletedDetail>(
          WORKSPACE_AUTOFIX_COMPLETED_EVENT,
          { detail },
        ),
      );
    });

    return unsubscribe;
  }, [autoFixInFlightChatId]);

  useEffect(() => {
    const handlePreviewRefreshRequest = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspacePreviewRefreshDetail>;
      const detail = customEvent.detail;
      if (!detail || detail.appId !== activeAppId) {
        return;
      }

      setPreviewRefreshToken((previous) => previous + 1);
    };

    window.addEventListener(
      WORKSPACE_PREVIEW_REFRESH_EVENT,
      handlePreviewRefreshRequest,
    );
    return () => {
      window.removeEventListener(
        WORKSPACE_PREVIEW_REFRESH_EVENT,
        handlePreviewRefreshRequest,
      );
    };
  }, [activeAppId]);

  const loadPreviewPaths = useCallback(async (appId: number) => {
    const appSource = await IpcClient.getInstance().readAppFile(
      appId,
      "src/App.tsx",
    );
    return extractPreviewPathsFromAppSource(appSource);
  }, []);

  const resolvedPreviewUrl = useMemo(() => {
    if (!appUrl) {
      return null;
    }
    return buildPreviewUrl(appUrl, selectedPath);
  }, [appUrl, selectedPath]);

  const iframeUrl = useMemo(() => {
    if (!resolvedPreviewUrl) {
      return null;
    }
    if (iframeRefreshToken <= 0) {
      return resolvedPreviewUrl;
    }

    const refreshedUrl = new URL(resolvedPreviewUrl, window.location.origin);
    refreshedUrl.searchParams.set(
      "__blaze_iframe_refresh",
      String(iframeRefreshToken),
    );
    return refreshedUrl.toString();
  }, [resolvedPreviewUrl, iframeRefreshToken]);

  useEffect(() => {
    setSelectedComponents([]);
    setIsPickingComponent(false);
    setSelectableCount(null);
    setRuntimeErrorIncident(null);
  }, [activeAppId, setSelectedComponents]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      if (
        event.data?.type === "blaze-selectable-components-updated" &&
        typeof event.data?.count === "number"
      ) {
        setSelectableCount(Math.max(0, event.data.count));
        return;
      }

      const { type, payload } = event.data as {
        type?:
          | "window-error"
          | "unhandled-rejection"
          | "iframe-sourcemapped-error"
          | "build-error-report";
        payload?: {
          message?: string;
          stack?: string;
          reason?: string;
          file?: string;
          frame?: string;
        };
      };

      if (
        type === "window-error" ||
        type === "unhandled-rejection" ||
        type === "iframe-sourcemapped-error"
      ) {
        const timestamp = Date.now();
        const stack =
          type === "iframe-sourcemapped-error"
            ? payload?.stack?.split("\n").slice(0, 1).join("\n")
            : payload?.stack;
        const errorMessage = `Error ${
          payload?.message || payload?.reason
        }\nStack trace: ${stack}`;
        setRuntimeErrorIncident({
          source: "preview-runtime",
          primaryError: errorMessage,
          timestamp,
          route: selectedPath,
          file: payload?.file,
          fingerprint: computeFingerprint(
            "preview-runtime",
            errorMessage,
            payload?.file,
          ),
        });
        if (activeAppId !== null) {
          const logEntry = {
            level: "error" as const,
            type: "client" as const,
            message: `Iframe error: ${errorMessage}`,
            appId: activeAppId,
            timestamp,
          };
          setConsoleEntries((prev) => [...prev, logEntry]);
        }
        return;
      }

      if (type === "build-error-report") {
        const timestamp = Date.now();
        const errorMessage = `${payload?.message} from file ${payload?.file}.\n\nSource code:\n${payload?.frame}`;
        setRuntimeErrorIncident({
          source: "preview-build",
          primaryError: errorMessage,
          timestamp,
          route: selectedPath,
          file: payload?.file,
          frame: payload?.frame,
          fingerprint: computeFingerprint(
            "preview-build",
            errorMessage,
            payload?.file,
          ),
        });
        if (activeAppId !== null) {
          const logEntry = {
            level: "error" as const,
            type: "client" as const,
            message: `Build error report: ${JSON.stringify(payload)}`,
            appId: activeAppId,
            timestamp,
          };
          setConsoleEntries((prev) => [...prev, logEntry]);
        }
        return;
      }

      const parsedSelection = parseComponentSelection(event.data);
      if (parsedSelection) {
        setSelectedComponents((previous) => {
          const exists = previous.some((component) => {
            if (parsedSelection.runtimeId && component.runtimeId) {
              return component.runtimeId === parsedSelection.runtimeId;
            }
            return component.id === parsedSelection.id;
          });
          return exists ? previous : [...previous, parsedSelection];
        });
        return;
      }

      if (
        event.data?.type === "blaze-component-deselected" &&
        typeof event.data?.componentId === "string"
      ) {
        const deselectedComponentId = event.data.componentId;
        const deselectedRuntimeId =
          typeof event.data?.runtimeId === "string"
            ? event.data.runtimeId
            : null;
        setSelectedComponents((previous) =>
          previous.filter((component) => {
            if (deselectedRuntimeId && component.runtimeId) {
              return component.runtimeId !== deselectedRuntimeId;
            }
            return component.id !== deselectedComponentId;
          }),
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [activeAppId, selectedPath, setConsoleEntries, setSelectedComponents]);

  const handleIframeRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      iframeRef.current = node;
      setPreviewIframeRef(node);
    },
    [setPreviewIframeRef],
  );

  const toggleComponentPicker = useCallback(() => {
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    setIsPickingComponent((previous) => {
      const next = !previous;
      iframeWindow.postMessage(
        {
          type: next
            ? "activate-blaze-component-selector"
            : "deactivate-blaze-component-selector",
        },
        "*",
      );
      return next;
    });
  }, []);

  const refreshIframe = useCallback(() => {
    if (!resolvedPreviewUrl) {
      return;
    }
    setIframeRefreshToken((previous) => previous + 1);
  }, [resolvedPreviewUrl]);

  const activeTabDefinition =
    RIGHT_PANEL_TABS.find((tab) => tab.id === activeTab) ?? RIGHT_PANEL_TABS[0];
  const ActiveTabIcon = activeTabDefinition.icon;

  useEffect(() => {
    let cancelled = false;

    const syncPreviewPaths = async () => {
      if (activeAppId === null) {
        setPreviewPaths(["/"]);
        setSelectedPath("/");
        return;
      }

      try {
        const paths = await loadPreviewPaths(activeAppId);
        if (cancelled) {
          return;
        }
        setPreviewPaths(paths);
        setSelectedPath((previousPath) =>
          paths.includes(previousPath) ? previousPath : (paths[0] ?? "/"),
        );
      } catch {
        if (cancelled) {
          return;
        }
        setPreviewPaths(["/"]);
        setSelectedPath("/");
      }
    };

    void syncPreviewPaths();

    return () => {
      cancelled = true;
    };
  }, [activeAppId, loadPreviewPaths]);

  useEffect(() => {
    let cancelled = false;

    const handleOutput = (output: AppOutput) => {
      if (cancelled || runningAppIdRef.current !== activeAppId) {
        return;
      }

      const proxyUrl = extractProxyUrl(output);
      if (proxyUrl) {
        setAppUrl(proxyUrl);
        setIsStarting(false);
      }
    };

    const syncAppPreview = async () => {
      const previousAppId = runningAppIdRef.current;
      const shouldRestartCurrentApp =
        previewRefreshToken > 0 && previousAppId === activeAppId;
      if (previousAppId !== null && previousAppId !== activeAppId) {
        try {
          await IpcClient.getInstance().stopApp(previousAppId);
        } catch (stopError) {
          console.error(`Failed to stop app ${previousAppId}:`, stopError);
        }
        if (cancelled) {
          return;
        }
      }

      if (activeAppId === null) {
        runningAppIdRef.current = null;
        setAppUrl(null);
        setError(null);
        setStartupErrorIncident(null);
        setRuntimeErrorIncident(null);
        setIsStarting(false);
        setSelectedComponents([]);
        setIsPickingComponent(false);
        setSelectableCount(null);
        return;
      }

      runningAppIdRef.current = activeAppId;
      setAppUrl(null);
      setError(null);
      setStartupErrorIncident(null);
      setRuntimeErrorIncident(null);
      setIsStarting(true);
      setSelectableCount(null);

      try {
        if (shouldRestartCurrentApp) {
          await IpcClient.getInstance().restartApp(activeAppId, handleOutput);
        } else {
          await IpcClient.getInstance().runApp(activeAppId, handleOutput);
        }
      } catch (runError) {
        if (cancelled) {
          return;
        }
        const resolvedError = resolveErrorMessage(
          runError,
          t("preview.error.startFailed"),
        );
        setError(resolvedError);
        setStartupErrorIncident({
          source: "server-stderr",
          primaryError: resolvedError,
          timestamp: Date.now(),
          route: "/",
          fingerprint: computeFingerprint("server-stderr", resolvedError),
        });
        setIsStarting(false);
      }
    };

    void syncAppPreview();

    return () => {
      cancelled = true;
    };
  }, [activeAppId, previewRefreshToken, t]);

  useEffect(() => {
    return () => {
      const appId = runningAppIdRef.current;
      if (appId !== null) {
        void IpcClient.getInstance()
          .stopApp(appId)
          .catch((stopError) => {
            console.error(`Failed to stop app ${appId}:`, stopError);
          });
      }
    };
  }, []);

  const onManualAutoFixAttempt = async () => {
    if (!error) {
      return;
    }
    const targetChatId = await ensureChatIdForAutoFix();
    if (!targetChatId) {
      return;
    }

    const incident: AutoFixIncident = startupErrorIncident ?? {
      source: "server-stderr",
      primaryError: error,
      timestamp: Date.now(),
      route: selectedPath,
      fingerprint: computeFingerprint("server-stderr", error),
    };

    const triggered = triggerAIFix({
      mode: "manual",
      incident,
      chatId: targetChatId,
    });
    if (triggered) {
      setStartupErrorIncident(null);
      setAutoFixInFlightChatId(targetChatId);
      const detail: WorkspaceAutofixStartedDetail = {
        chatId: targetChatId,
        message: t("chat.autofix.started"),
      };
      window.dispatchEvent(
        new CustomEvent<WorkspaceAutofixStartedDetail>(
          WORKSPACE_AUTOFIX_STARTED_EVENT,
          { detail },
        ),
      );
    }
  };

  const onRuntimeAutoFixAttempt = async () => {
    if (!runtimeErrorIncident) {
      return;
    }
    const targetChatId = await ensureChatIdForAutoFix();
    if (!targetChatId) {
      return;
    }

    const triggered = triggerAIFix({
      mode: "manual",
      incident: runtimeErrorIncident,
      chatId: targetChatId,
    });
    if (triggered) {
      setRuntimeErrorIncident(null);
      setAutoFixInFlightChatId(targetChatId);
      const detail: WorkspaceAutofixStartedDetail = {
        chatId: targetChatId,
        message: t("chat.autofix.started"),
      };
      window.dispatchEvent(
        new CustomEvent<WorkspaceAutofixStartedDetail>(
          WORKSPACE_AUTOFIX_STARTED_EVENT,
          { detail },
        ),
      );
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-muted/50">
      <div className="flex items-center gap-0 border-b border-border bg-card px-2">
        {RIGHT_PANEL_TABS.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`preview-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              }`}
            >
              <TabIcon size={14} />
              {t(tab.labelKey)}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
      {activeTab === "preview" ? (
        <>
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-1">
              {(["desktop", "tablet", "mobile"] as Device[]).map((item) => {
                const Icon =
                  item === "desktop"
                    ? Monitor
                    : item === "tablet"
                      ? Tablet
                      : Smartphone;
                return (
                  <button
                    key={item}
                    onClick={() => setDevice(item)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      device === item
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={t(`preview.device.${item}`)}
                    aria-label={t(`preview.device.${item}`)}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
              {activeAppId !== null && (
                <div className="ml-3 border-l border-border pl-3 text-xs text-muted-foreground">
                  {t("preview.label.appId", { id: activeAppId })}
                </div>
              )}
              {activeAppId !== null && (
                <label className="ml-2 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1">
                  <span className="text-[11px] text-muted-foreground">
                    {t("preview.label.page")}
                  </span>
                  <select
                    value={selectedPath}
                    onChange={(event) => {
                      setSelectedPath(event.target.value);
                    }}
                    onFocus={() => {
                      if (activeAppId === null) {
                        return;
                      }
                      void loadPreviewPaths(activeAppId)
                        .then((paths) => {
                          setPreviewPaths(paths);
                          setSelectedPath((previousPath) =>
                            paths.includes(previousPath)
                              ? previousPath
                              : (paths[0] ?? "/"),
                          );
                        })
                        .catch(() => {});
                    }}
                    aria-label={t("preview.aria.pageSelect")}
                    className="max-w-[180px] rounded bg-transparent text-xs text-foreground outline-none"
                  >
                    {previewPaths.map((pathValue) => (
                      <option key={pathValue} value={pathValue}>
                        {getPreviewPathLabel(
                          pathValue,
                          t("preview.route.home"),
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Eye size={14} />
                {t("preview.button.preview")}
              </button>
              <button
                onClick={refreshIframe}
                data-testid="preview-refresh-iframe-button"
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("preview.aria.refreshIframe")}
                disabled={!resolvedPreviewUrl}
              >
                <RefreshCw size={14} />
                {t("preview.button.refresh")}
              </button>
              <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Download size={14} />
                {t("preview.button.export")}
              </button>
              <button
                onClick={toggleComponentPicker}
                disabled={!resolvedPreviewUrl}
                data-testid="toggle-component-picker-button"
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  isPickingComponent
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-label={t("preview.aria.toggleComponentPicker")}
              >
                <MousePointerClick size={14} />
                {t(
                  isPickingComponent
                    ? "preview.button.selectComponent.active"
                    : "preview.button.selectComponent",
                )}
                {selectedComponents.length > 0 && (
                  <span
                    data-testid="preview-selected-components-count"
                    className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold"
                  >
                    {selectedComponents.length}
                  </span>
                )}
                {isPickingComponent && selectableCount !== null && (
                  <span
                    data-testid="preview-selectable-components-count"
                    className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                  >
                    {selectableCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  if (resolvedPreviewUrl) {
                    window.open(
                      resolvedPreviewUrl,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("preview.aria.openNewTab")}
                disabled={!resolvedPreviewUrl}
              >
                <ExternalLink size={14} />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-start justify-center overflow-auto p-6">
            <div
              className="h-full min-h-[520px] max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              style={{ width: previewWidthByDevice[device] }}
            >
              {activeAppId === null ? (
                <div className="flex h-full min-h-[520px] flex-col items-center justify-center p-8 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                    <Monitor size={20} className="text-muted-foreground" />
                  </div>
                  <h3 className="mb-1 text-sm font-medium text-foreground">
                    {t("preview.empty.title")}
                  </h3>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {t("preview.empty.subtitle")}
                  </p>
                </div>
              ) : error ? (
                <div className="flex h-full min-h-[520px] flex-col items-center justify-center p-8 text-center">
                  <p className="text-sm font-medium text-destructive">
                    {t("preview.error.title")}
                  </p>
                  <p className="mt-2 max-w-md text-xs text-muted-foreground">
                    {error}
                  </p>
                  <div className="mt-4 w-full max-w-md rounded-lg border border-border bg-background p-3 text-left">
                    <p className="text-xs text-muted-foreground">
                      {t("preview.error.autofixSuggestion")}
                    </p>
                    <button
                      type="button"
                      data-testid="preview-autofix-button"
                      onClick={() => {
                        void onManualAutoFixAttempt();
                      }}
                      disabled={
                        isStreaming ||
                        isPreparingAutoFixChat ||
                        autoFixInFlightChatId !== null
                      }
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Sparkles size={14} />
                      {isStreaming ||
                      isPreparingAutoFixChat ||
                      autoFixInFlightChatId !== null
                        ? t("preview.error.autofixButtonLoading")
                        : t("preview.error.autofixButton")}
                    </button>
                  </div>
                </div>
              ) : isStarting || !resolvedPreviewUrl ? (
                <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                  <Loader2
                    size={20}
                    className="animate-spin text-muted-foreground"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("preview.loading")}
                  </p>
                </div>
              ) : (
                <div className="relative h-full min-h-[520px] w-full">
                  {runtimeErrorIncident && (
                    <div className="absolute left-3 top-3 z-20 max-w-[420px] rounded-lg border border-border bg-background/95 p-3 shadow">
                      <p className="text-xs text-muted-foreground">
                        {t("preview.error.autofixSuggestion")}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          data-testid="preview-runtime-autofix-button"
                          onClick={() => {
                            void onRuntimeAutoFixAttempt();
                          }}
                          disabled={
                            isStreaming ||
                            isPreparingAutoFixChat ||
                            autoFixInFlightChatId !== null
                          }
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Sparkles size={14} />
                          {isStreaming ||
                          isPreparingAutoFixChat ||
                          autoFixInFlightChatId !== null
                            ? t("preview.error.autofixButtonLoading")
                            : t("preview.error.autofixButton")}
                        </button>
                        <button
                          type="button"
                          data-testid="preview-runtime-autofix-dismiss"
                          onClick={() => setRuntimeErrorIncident(null)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {t("preview.error.autofixDismiss")}
                        </button>
                      </div>
                    </div>
                  )}
                  <iframe
                    title={t("preview.iframe.title")}
                    src={iframeUrl ?? undefined}
                    className="h-full min-h-[520px] w-full border-0"
                    ref={handleIframeRef}
                    onLoad={() => {
                      if (
                        isPickingComponent &&
                        iframeRef.current?.contentWindow
                      ) {
                        iframeRef.current.contentWindow.postMessage(
                          { type: "activate-blaze-component-selector" },
                          "*",
                        );
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div
          data-testid="preview-tab-placeholder"
          className="flex flex-1 flex-col items-center justify-center p-8 text-center"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <ActiveTabIcon size={20} className="text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-sm font-medium text-foreground">
            {t(activeTabDefinition.labelKey)}
          </h3>
          <p className="max-w-xs text-xs text-muted-foreground">
            {t("preview.tab.comingSoon")}
          </p>
        </div>
      )}
    </div>
  );
}
