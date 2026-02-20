import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "./messages/en";
import {
  getMessageCatalog,
  resetI18nWarningsForTests,
  t,
  type MessageKey,
} from "./translator";

describe("i18n translator", () => {
  beforeEach(() => {
    resetI18nWarningsForTests();
  });

  it("returns translated message and interpolates params", () => {
    expect(t("ru", "auth.title.login")).toBe("С возвращением");
    expect(t("en", "sidebar.scope.projectsCount", { count: 3 })).toBe(
      "3 projects in scope",
    );
  });

  it("falls back to English when locale key is missing and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ruCatalog = getMessageCatalog("ru") as Record<string, string>;
    const key: MessageKey = "auth.button.signIn";
    const originalValue = ruCatalog[key];

    delete ruCatalog[key];

    expect(t("ru", key)).toBe(en[key]);
    expect(t("ru", key)).toBe(en[key]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    ruCatalog[key] = originalValue;
    warnSpy.mockRestore();
  });

  it("returns key when translation is missing everywhere", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(t("ru", "unknown.translation.key")).toBe("unknown.translation.key");

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
