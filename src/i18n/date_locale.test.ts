import { describe, expect, it } from "vitest";
import { enUS, ru } from "date-fns/locale";
import { getDateFnsLocale, getIntlLocaleCode } from "./date_locale";

describe("i18n date locale", () => {
  it("returns date-fns locale by UI language", () => {
    expect(getDateFnsLocale("en")).toBe(enUS);
    expect(getDateFnsLocale("ru")).toBe(ru);
  });

  it("returns Intl locale code by UI language", () => {
    expect(getIntlLocaleCode("en")).toBe("en-US");
    expect(getIntlLocaleCode("ru")).toBe("ru-RU");
  });
});
