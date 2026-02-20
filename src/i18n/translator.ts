import { en } from "./messages/en";
import { ru } from "./messages/ru";
import type { MessageCatalog, TranslationParams, UiLanguage } from "./types";

export type MessageKey = keyof typeof en;

const messageCatalogByLanguage: Record<UiLanguage, MessageCatalog> = {
  en,
  ru,
};

const warnedMissingKeys = new Set<string>();

function warnMissingOnce(token: string, message: string) {
  if (warnedMissingKeys.has(token)) {
    return;
  }
  warnedMissingKeys.add(token);
  console.warn(message);
}

function interpolateMessage(
  message: string,
  params?: TranslationParams,
): string {
  if (!params) {
    return message;
  }

  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, paramName) => {
    const value = params[paramName];
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  });
}

export function t(
  language: UiLanguage,
  key: MessageKey | string,
  params?: TranslationParams,
): string {
  const activeMessages = messageCatalogByLanguage[language];
  const englishMessages = messageCatalogByLanguage.en;

  if (!Object.prototype.hasOwnProperty.call(activeMessages, key)) {
    warnMissingOnce(
      `missing:${language}:${key}`,
      `[i18n] Missing translation for key "${key}" in locale "${language}". Falling back to English.`,
    );
  }

  const resolvedMessage = activeMessages[key] ?? englishMessages[key];
  if (!resolvedMessage) {
    warnMissingOnce(
      `missing-key:${key}`,
      `[i18n] Missing translation key "${key}" in all locales.`,
    );
    return String(key);
  }

  return interpolateMessage(resolvedMessage, params);
}

export function getMessageCatalog(language: UiLanguage): MessageCatalog {
  return messageCatalogByLanguage[language];
}

export function resetI18nWarningsForTests() {
  warnedMissingKeys.clear();
}
