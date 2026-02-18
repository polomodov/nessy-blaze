import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import type { AppOutput } from "@/ipc/ipc_types";

type Device = "desktop" | "tablet" | "mobile";

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

function resolveErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to start preview app.";
}

interface BlazePreviewPanelProps {
  activeAppId: number | null;
}

export function BlazePreviewPanel({ activeAppId }: BlazePreviewPanelProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningAppIdRef = useRef<number | null>(null);

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
        setIsStarting(false);
        return;
      }

      runningAppIdRef.current = activeAppId;
      setAppUrl(null);
      setError(null);
      setIsStarting(true);

      try {
        await IpcClient.getInstance().runApp(activeAppId, handleOutput);
      } catch (runError) {
        if (cancelled) {
          return;
        }
        setError(resolveErrorMessage(runError));
        setIsStarting(false);
      }
    };

    void syncAppPreview();

    return () => {
      cancelled = true;
    };
  }, [activeAppId]);

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

  return (
    <div className="flex h-full w-full flex-col bg-muted/50">
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
                title={item}
                aria-label={item}
              >
                <Icon size={16} />
              </button>
            );
          })}
          {activeAppId !== null && (
            <div className="ml-3 border-l border-border pl-3 text-xs text-muted-foreground">
              App #{activeAppId}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Eye size={14} />
            Preview
          </button>
          <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Download size={14} />
            Export
          </button>
          <button
            onClick={() => {
              if (appUrl) {
                window.open(appUrl, "_blank", "noopener,noreferrer");
              }
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Open in new tab"
            disabled={!appUrl}
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
                App preview
              </h3>
              <p className="max-w-xs text-xs text-muted-foreground">
                Send a message in chat to create an app and run live preview.
              </p>
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center p-8 text-center">
              <p className="text-sm font-medium text-destructive">
                Failed to start preview
              </p>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                {error}
              </p>
            </div>
          ) : isStarting || !appUrl ? (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-center">
              <Loader2
                size={20}
                className="animate-spin text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">
                Starting app on preview port...
              </p>
            </div>
          ) : (
            <iframe
              title="Generated app preview"
              src={appUrl}
              className="h-full min-h-[520px] w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
