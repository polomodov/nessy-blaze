export type UiLanguage = "ru" | "en";

export type TranslationParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export type MessageCatalog = Record<string, string>;
