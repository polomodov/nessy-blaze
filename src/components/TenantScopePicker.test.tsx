import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKEND_MODE_STORAGE_KEY,
  TENANT_ORG_ID_STORAGE_KEY,
  TENANT_WORKSPACE_ID_STORAGE_KEY,
} from "@/ipc/backend_client";
import type { TenantWorkspace } from "@/ipc/ipc_types";
import { TenantScopePicker } from "./TenantScopePicker";

const { listOrganizationsMock, listWorkspacesMock, createWorkspaceMock } =
  vi.hoisted(() => ({
    listOrganizationsMock: vi.fn(),
    listWorkspacesMock: vi.fn(),
    createWorkspaceMock: vi.fn(),
  }));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      listOrganizations: listOrganizationsMock,
      listWorkspaces: listWorkspacesMock,
      createWorkspace: createWorkspaceMock,
    })),
  },
}));

function renderPicker(onScopeChange: () => Promise<void> | void = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TenantScopePicker onScopeChange={onScopeChange} />
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

describe("TenantScopePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    const localStorageMock = createLocalStorageMock({
      [BACKEND_MODE_STORAGE_KEY]: "http",
      [TENANT_ORG_ID_STORAGE_KEY]: "org_1",
      [TENANT_WORKSPACE_ID_STORAGE_KEY]: "ws_1",
    });
    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });

    listOrganizationsMock.mockResolvedValue([
      {
        id: "org_1",
        slug: "org-1",
        name: "Org One",
        role: "owner",
        status: "active",
        createdAt: "2026-02-19T00:00:00.000Z",
        updatedAt: "2026-02-19T00:00:00.000Z",
      },
    ]);

    let workspaces: TenantWorkspace[] = [
      {
        id: "ws_1",
        organizationId: "org_1",
        slug: "personal",
        name: "Personal",
        type: "personal",
        createdByUserId: "user_1",
        createdAt: "2026-02-19T00:00:00.000Z",
        updatedAt: "2026-02-19T00:00:00.000Z",
      },
    ];

    listWorkspacesMock.mockImplementation(async () => workspaces);
    createWorkspaceMock.mockImplementation(
      async ({
        orgId,
        name,
      }: {
        orgId: string;
        name: string;
      }): Promise<TenantWorkspace> => {
        const createdWorkspace: TenantWorkspace = {
          id: "ws_2",
          organizationId: orgId,
          slug: "design",
          name,
          type: "team",
          createdByUserId: "user_1",
          createdAt: "2026-02-19T10:00:00.000Z",
          updatedAt: "2026-02-19T10:00:00.000Z",
        };
        workspaces = [...workspaces, createdWorkspace];
        return createdWorkspace;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates workspace and switches scope to it", async () => {
    const onScopeChange = vi.fn().mockResolvedValue(undefined);

    renderPicker(onScopeChange);

    await screen.findByText("Org One");
    await screen.findByText("Personal");

    fireEvent.change(screen.getByTestId("create-workspace-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-workspace-button"));

    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith({
        orgId: "org_1",
        name: "Design",
        type: "team",
      });
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(TENANT_ORG_ID_STORAGE_KEY)).toBe(
        "org_1",
      );
      expect(window.localStorage.getItem(TENANT_WORKSPACE_ID_STORAGE_KEY)).toBe(
        "ws_2",
      );
    });
    expect(onScopeChange).toHaveBeenCalledTimes(1);
  });

  it("shows create error and keeps current scope when request fails", async () => {
    createWorkspaceMock.mockRejectedValueOnce(
      new Error("Only organization owner/admin can create team workspaces"),
    );
    const onScopeChange = vi.fn();

    renderPicker(onScopeChange);

    await screen.findByText("Org One");

    fireEvent.change(screen.getByTestId("create-workspace-input"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByTestId("create-workspace-button"));

    await screen.findByText(
      "Only organization owner/admin can create team workspaces",
    );

    expect(window.localStorage.getItem(TENANT_WORKSPACE_ID_STORAGE_KEY)).toBe(
      "ws_1",
    );
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("handles non-array organizations response without crashing", async () => {
    listOrganizationsMock.mockResolvedValueOnce({
      organizations: [],
    });

    renderPicker();

    await screen.findByText(/(No organizations found|Организации не найдены)/);
    expect(listWorkspacesMock).not.toHaveBeenCalled();
  });

  it("handles non-array workspaces response without crashing", async () => {
    listWorkspacesMock.mockResolvedValueOnce({
      workspaces: [],
    });

    renderPicker();

    await screen.findByText("Org One");
    await screen.findByText(/(No workspaces found|Рабочие области не найдены)/);
  });
});
