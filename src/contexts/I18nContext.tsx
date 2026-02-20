import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";
import { t as translate, type MessageKey } from "@/i18n/translator";
import type { TranslationParams, UiLanguage } from "@/i18n/types";

export const UI_LANGUAGE_STORAGE_KEY = "blaze.ui.language";

interface I18nContextValue {
  language: UiLanguage;
  setLanguage: (next: UiLanguage) => Promise<void>;
  t: (key: MessageKey | string, params?: TranslationParams) => string;
}

function normalizeLanguage(
  value: string | null | undefined,
): UiLanguage | null {
  if (value === "ru" || value === "en") {
    return value;
  }
  return null;
}

function getLanguageFromLocalStorage(): UiLanguage | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage || typeof storage.getItem !== "function") {
    return null;
  }

  const value = storage.getItem(UI_LANGUAGE_STORAGE_KEY);
  return normalizeLanguage(value);
}

function writeLanguageToLocalStorage(language: UiLanguage) {
  if (typeof window === "undefined") {
    return;
  }

  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage || typeof storage.setItem !== "function") {
    return;
  }
  storage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
}

const fallbackLanguage: UiLanguage = getLanguageFromLocalStorage() ?? "ru";

const I18nContext = createContext<I18nContextValue>({
  language: fallbackLanguage,
  setLanguage: async () => {},
  t: (key, params) => translate(fallbackLanguage, key, params),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const initialSettingsLanguage = normalizeLanguage(settings?.uiLanguage);
  const [language, setLanguageState] = useState<UiLanguage>(
    () => initialSettingsLanguage ?? getLanguageFromLocalStorage() ?? "ru",
  );
  const lastSeenSettingsLanguageRef = useRef<UiLanguage | null>(
    initialSettingsLanguage,
  );

  useEffect(() => {
    const settingsLanguage = normalizeLanguage(settings?.uiLanguage);
    if (!settingsLanguage) {
      return;
    }

    // Ignore unchanged settings payloads to avoid overriding optimistic UI state
    // before useSettings reflects the saved language.
    if (lastSeenSettingsLanguageRef.current === settingsLanguage) {
      return;
    }

    lastSeenSettingsLanguageRef.current = settingsLanguage;
    if (settingsLanguage === language) {
      return;
    }

    setLanguageState(settingsLanguage);
    writeLanguageToLocalStorage(settingsLanguage);
  }, [language, settings?.uiLanguage]);

  const setLanguage = useCallback(
    async (nextLanguage: UiLanguage) => {
      if (nextLanguage === language) {
        return;
      }

      const previousLanguage = language;
      setLanguageState(nextLanguage);
      writeLanguageToLocalStorage(nextLanguage);

      try {
        await updateSettings({ uiLanguage: nextLanguage });
      } catch {
        setLanguageState(previousLanguage);
        writeLanguageToLocalStorage(previousLanguage);
        showError(translate(previousLanguage, "i18n.language.saveError"));
      }
    },
    [language, updateSettings],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
