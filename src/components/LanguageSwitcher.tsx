import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/I18nContext";
import type { UiLanguage } from "@/i18n/types";

interface LanguageSwitcherProps {
  variant?: "default" | "compact";
  className?: string;
}

const LANGUAGES: UiLanguage[] = ["ru", "en"];

export function LanguageSwitcher({
  variant = "default",
  className,
}: LanguageSwitcherProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-background p-1",
        variant === "compact" ? "gap-1" : "gap-2",
        className,
      )}
      data-testid="language-switcher"
      aria-label={t("i18n.language.label")}
    >
      {LANGUAGES.map((value) => {
        const isActive = language === value;
        const languageLabel = t(`i18n.language.${value}`);
        return (
          <button
            key={value}
            type="button"
            data-testid={`language-option-${value}`}
            onClick={() => {
              void setLanguage(value);
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
            aria-label={t("i18n.language.switchTo", {
              language: languageLabel,
            })}
            aria-pressed={isActive}
          >
            {value.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
