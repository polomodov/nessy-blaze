import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, UI_LANGUAGE_STORAGE_KEY } from "@/contexts/I18nContext";
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
  DEV_USER_NAME_STORAGE_KEY,
  DEV_USER_SUB_STORAGE_KEY,
} from "@/ipc/backend_client";
import AuthPage from "./auth";

const {
  navigateMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  updateSettingsMock,
  settingsRef,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  settingsRef: {
    current: { uiLanguage: "ru" as const },
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    info: toastInfoMock,
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settingsRef.current,
    updateSettings: updateSettingsMock,
  }),
}));

function renderAuthPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

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

describe("AuthPage", () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock();
    const sessionStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(window, "sessionStorage", {
      value: sessionStorageMock,
      configurable: true,
    });
    window.history.pushState({}, "", "/auth");
    vi.clearAllMocks();
    settingsRef.current = { uiLanguage: "ru" };
    updateSettingsMock.mockResolvedValue({ uiLanguage: "ru" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves auth credentials and navigates home on sign in", () => {
    renderAuthPage();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "dev@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "secret-pass" },
    });
    fireEvent.change(screen.getByLabelText("Bearer токен (опционально)"), {
      target: { value: "sample-jwt-token" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe(
      "sample-jwt-token",
    );
    expect(window.localStorage.getItem(DEV_USER_SUB_STORAGE_KEY)).toBe("dev");
    expect(window.localStorage.getItem(DEV_USER_EMAIL_STORAGE_KEY)).toBe(
      "dev@example.com",
    );
    expect(window.localStorage.getItem(DEV_USER_NAME_STORAGE_KEY)).toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith("Данные входа сохранены.");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
  });

  it("starts OAuth2 flow when clicking Google sign in", async () => {
    const assignMock = vi.fn();
    vi.spyOn(window.location, "assign").mockImplementation(assignMock);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            enabled: true,
            providerName: "Google",
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            clientId: "client-123",
            scope: "openid profile email",
            redirectUri: "http://localhost:5173/auth",
            extraAuthParams: { prompt: "consent" },
          },
        }),
      }),
    );

    renderAuthPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Продолжить с Google" }),
    );

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledTimes(1);
    });

    const oauthState = window.sessionStorage.getItem("blaze.auth.oauth2.state");
    const oauthVerifier = window.sessionStorage.getItem(
      "blaze.auth.oauth2.code_verifier",
    );
    expect(oauthState).toBeTruthy();
    expect(oauthVerifier).toBeTruthy();

    const redirectUrl = String(assignMock.mock.calls[0][0]);
    const parsed = new URL(redirectUrl);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("handles OAuth2 callback and stores returned token", async () => {
    const expectedState = "state-123";
    const expectedVerifier = "verifier-123";
    window.sessionStorage.setItem("blaze.auth.oauth2.state", expectedState);
    window.sessionStorage.setItem(
      "blaze.auth.oauth2.code_verifier",
      expectedVerifier,
    );
    window.history.pushState(
      {},
      "",
      `/auth?code=oauth-code&state=${expectedState}`,
    );

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              enabled: true,
              providerName: "Google",
              authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
              clientId: "client-123",
              scope: "openid profile email",
              redirectUri: "http://localhost:5173/auth",
              extraAuthParams: {},
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              accessToken:
                "eyJhbGciOiJub25lIn0.eyJzdWIiOiJvYXV0aC11c2VyIiwiZW1haWwiOiJvYXV0aEBleGFtcGxlLmNvbSIsIm5hbWUiOiJPQXV0aCBVc2VyIn0.sig",
              idToken: null,
              refreshToken: null,
              tokenType: "Bearer",
              expiresIn: 3600,
              scope: "openid profile email",
            },
          }),
        }),
    );

    renderAuthPage();

    await waitFor(() => {
      expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeTruthy();
      expect(window.localStorage.getItem(DEV_USER_SUB_STORAGE_KEY)).toBe(
        "oauth-user",
      );
      expect(window.localStorage.getItem(DEV_USER_EMAIL_STORAGE_KEY)).toBe(
        "oauth@example.com",
      );
      expect(window.localStorage.getItem(DEV_USER_NAME_STORAGE_KEY)).toBe(
        "OAuth User",
      );
      expect(toastSuccessMock).toHaveBeenCalledWith("Вход выполнен успешно.");
      expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
    });
  });

  it("clears saved credentials", () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "token");
    window.localStorage.setItem(DEV_USER_SUB_STORAGE_KEY, "dev-user");
    window.localStorage.setItem(DEV_USER_EMAIL_STORAGE_KEY, "dev@example.com");
    window.localStorage.setItem(DEV_USER_NAME_STORAGE_KEY, "Dev User");

    renderAuthPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Очистить сохраненные данные" }),
    );

    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEV_USER_SUB_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEV_USER_EMAIL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEV_USER_NAME_STORAGE_KEY)).toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Сохраненные данные очищены.",
    );
  });

  it("renders Russian copy by default", () => {
    renderAuthPage();

    expect(screen.getByText("С возвращением")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy();
  });

  it("switches language to English and persists preference", async () => {
    renderAuthPage();

    fireEvent.click(screen.getByTestId("language-option-en"));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ uiLanguage: "en" });
      expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe("en");
      expect(screen.getByText("Welcome back")).toBeTruthy();
    });
  });
});
