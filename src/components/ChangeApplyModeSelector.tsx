import { useI18n } from "@/contexts/I18nContext";
import { useSettings } from "@/hooks/useSettings";
import { showInfo } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ApplyMode = "auto" | "manual";

interface ChangeApplyModeSelectorProps {
  variant?: "default" | "compact";
  showToast?: boolean;
  className?: string;
}

export function ChangeApplyModeSelector({
  variant = "default",
  showToast = true,
  className,
}: ChangeApplyModeSelectorProps) {
  const { settings, updateSettings } = useSettings();
  const { t } = useI18n();
  const isCompact = variant === "compact";
  const applyMode: ApplyMode = settings?.autoApproveChanges ? "auto" : "manual";
  const manualLabel = isCompact
    ? t("applyMode.compact.manual")
    : t("applyMode.manual");
  const autoLabel = isCompact
    ? t("applyMode.compact.auto")
    : t("applyMode.auto");

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== "auto" && nextMode !== "manual") {
      return;
    }

    const nextAutoApprove = nextMode === "auto";
    if (settings?.autoApproveChanges === nextAutoApprove) {
      return;
    }

    void updateSettings({ autoApproveChanges: nextAutoApprove });

    if (showToast) {
      showInfo(
        nextAutoApprove
          ? t("applyMode.toast.autoEnabled")
          : t("applyMode.toast.manualEnabled"),
      );
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        !isCompact && "flex-col items-start gap-1.5",
        className,
      )}
      data-testid="apply-mode-selector"
    >
      {!isCompact && (
        <span className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("applyMode.label")}
        </span>
      )}
      <ToggleGroup
        type="single"
        value={applyMode}
        onValueChange={handleModeChange}
        variant="outline"
        size="sm"
        className={cn("min-w-0", isCompact ? "max-w-[220px]" : "w-full")}
        aria-label={t("applyMode.aria.label")}
      >
        <ToggleGroupItem
          value="manual"
          data-testid="apply-mode-manual"
          aria-label={t("applyMode.aria.manual")}
          className={cn(
            "h-auto min-w-0 whitespace-normal px-2 py-1 text-center leading-tight",
            !isCompact && "px-2.5",
          )}
        >
          {manualLabel}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="auto"
          data-testid="apply-mode-auto"
          aria-label={t("applyMode.aria.auto")}
          className={cn(
            "h-auto min-w-0 whitespace-normal px-2 py-1 text-center leading-tight",
            !isCompact && "px-2.5",
          )}
        >
          {autoLabel}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
