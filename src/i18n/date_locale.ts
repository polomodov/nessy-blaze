import type { Locale } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import type { UiLanguage } from "./types";

const dateFnsLocaleByLanguage: Record<UiLanguage, Locale> = {
  en: enUS,
  ru,
};

const intlLocaleCodeByLanguage: Record<UiLanguage, string> = {
  en: "en-US",
  ru: "ru-RU",
};

export function getDateFnsLocale(language: UiLanguage): Locale {
  return dateFnsLocaleByLanguage[language];
}

export function getIntlLocaleCode(language: UiLanguage): string {
  return intlLocaleCodeByLanguage[language];
}
