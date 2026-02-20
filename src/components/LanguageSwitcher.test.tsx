import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, UI_LANGUAGE_STORAGE_KEY } from "@/contexts/I18nContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

const { settingsRef, updateSettingsMock } = vi.hoisted(() => ({
  settingsRef: {
    current: { uiLanguage: "ru" } as { uiLanguage: "ru" | "en" } | null,
  },
  updateSettingsMock: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settingsRef.current,
    updateSettings: updateSettingsMock,
  }),
}));

function createLocalStorageMock(
  initialValues: Record<string, string> = {},
): Storage {
  const store = new Map<string, string>(Object.entries(initialValues));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

function renderSwitcher() {
  return render(
    <I18nProvider>
      <LanguageSwitcher />
    </I18nProvider>,
  );
}

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });

    settingsRef.current = { uiLanguage: "ru" };
    updateSettingsMock.mockResolvedValue({ uiLanguage: "ru" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows Russian as default selected language", () => {
    renderSwitcher();

    expect(
      screen.getByTestId("language-option-ru").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("language-option-en").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("uses localStorage language when settings are not loaded", () => {
    settingsRef.current = null;
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");

    renderSwitcher();

    expect(
      screen.getByTestId("language-option-en").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("switches language and persists to user settings", async () => {
    renderSwitcher();

    fireEvent.click(screen.getByTestId("language-option-en"));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ uiLanguage: "en" });
      expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("en");
      expect(
        screen.getByTestId("language-option-en").getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });

  it("reverts language when settings update fails", async () => {
    updateSettingsMock.mockRejectedValueOnce(new Error("failed"));

    renderSwitcher();

    fireEvent.click(screen.getByTestId("language-option-en"));

    await waitFor(() => {
      expect(
        screen.getByTestId("language-option-ru").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("ru");
    });
  });
});
