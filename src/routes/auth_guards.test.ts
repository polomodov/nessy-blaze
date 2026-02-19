import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
} from "@/ipc/backend_client";
import { hasStoredAuthContext } from "@/lib/auth_storage";
import { authRoute } from "./auth";
import { homeRoute } from "./home";

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

function runBeforeLoad(route: unknown): unknown {
  const beforeLoad = (
    route as {
      options?: {
        beforeLoad?: () => unknown;
      };
    }
  ).options?.beforeLoad;

  if (!beforeLoad) {
    throw new Error("beforeLoad is not defined on route");
  }

  try {
    beforeLoad();
    return null;
  } catch (error) {
    return error;
  }
}

describe("auth route guards", () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects stored auth context from localStorage", () => {
    expect(hasStoredAuthContext()).toBe(false);
    window.localStorage.setItem(DEV_USER_EMAIL_STORAGE_KEY, "dev@example.com");
    expect(hasStoredAuthContext()).toBe(true);
  });

  it("redirects home route to auth when credentials are missing", () => {
    const thrown = runBeforeLoad(homeRoute) as { options?: { to?: string } };
    expect(thrown?.options?.to).toBe("/auth");
  });

  it("allows home route when credentials exist", () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "test-token");
    const thrown = runBeforeLoad(homeRoute);
    expect(thrown).toBeNull();
  });

  it("redirects auth route to home when credentials exist", () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "test-token");
    const thrown = runBeforeLoad(authRoute) as { options?: { to?: string } };
    expect(thrown?.options?.to).toBe("/");
  });

  it("allows auth route when credentials are missing", () => {
    const thrown = runBeforeLoad(authRoute);
    expect(thrown).toBeNull();
  });
});
