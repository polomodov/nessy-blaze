import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_USER_EMAIL_STORAGE_KEY,
} from "@/ipc/backend_client";
import { BlazeSidebar } from "./BlazeSidebar";

const { listAppsMock } = vi.hoisted(() => ({
  listAppsMock: vi.fn(),
}));

const { settingsRef, updateSettingsMock } = vi.hoisted(() => ({
  settingsRef: {
    current: { autoApproveChanges: true } as {
      autoApproveChanges?: boolean;
    } | null,
  },
  updateSettingsMock: vi.fn(),
}));

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
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

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      listApps: listAppsMock,
      listOrganizations: vi.fn().mockResolvedValue([]),
      listWorkspaces: vi.fn().mockResolvedValue([]),
    })),
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settingsRef.current,
    updateSettings: updateSettingsMock,
  }),
}));

function createStorageMock(
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

function renderSidebar(
  props: Partial<ComponentProps<typeof BlazeSidebar>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const baseProps: ComponentProps<typeof BlazeSidebar> = {
    activeProjectId: null,
    collapsed: false,
    isDarkMode: false,
    onToggleTheme: vi.fn(),
    onToggleCollapse: vi.fn(),
    onSelectProject: vi.fn(),
    onNewProject: vi.fn(),
    projectsRefreshToken: 0,
  };

  const view = render(
    <QueryClientProvider client={queryClient}>
      <BlazeSidebar {...baseProps} {...props} />
    </QueryClientProvider>,
  );

  return { ...view, queryClient, baseProps };
}

describe("BlazeSidebar", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock(),
      configurable: true,
    });
    vi.clearAllMocks();
    settingsRef.current = { autoApproveChanges: true };
    updateSettingsMock.mockResolvedValue({ autoApproveChanges: true });
    listAppsMock.mockResolvedValue({
      apps: [
        {
          id: 101,
          name: "Landing",
          createdAt: "2026-02-18T10:00:00.000Z",
        },
      ],
    });
  });

  it("calls onSelectProject when a project item is clicked", async () => {
    const onSelectProject = vi.fn();

    renderSidebar({ onSelectProject });

    const projectTitle = await screen.findByText("Landing");
    const projectButton = projectTitle.closest("button");
    expect(projectButton).toBeTruthy();
    fireEvent.click(projectButton as HTMLButtonElement);

    expect(onSelectProject).toHaveBeenCalledWith(101);
  });

  it("calls onNewProject when new project button is clicked", () => {
    const onNewProject = vi.fn();

    renderSidebar({ onNewProject });

    fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleTheme when theme button is clicked", () => {
    const onToggleTheme = vi.fn();

    renderSidebar({ onToggleTheme });

    fireEvent.click(screen.getByRole("button", { name: "Темная тема" }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("reloads project list when refresh token changes", async () => {
    listAppsMock
      .mockResolvedValueOnce({
        apps: [
          {
            id: 101,
            name: "Landing",
            createdAt: "2026-02-18T10:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        apps: [
          {
            id: 101,
            name: "Landing",
            createdAt: "2026-02-18T10:00:00.000Z",
          },
          {
            id: 202,
            name: "New Project",
            createdAt: "2026-02-19T10:00:00.000Z",
          },
        ],
      });

    const view = renderSidebar({ projectsRefreshToken: 0 });
    await screen.findByText("Landing");
    expect(screen.queryByText("New Project")).toBeNull();

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <BlazeSidebar {...view.baseProps} projectsRefreshToken={1} />
      </QueryClientProvider>,
    );

    await screen.findByText("New Project");
    expect(listAppsMock).toHaveBeenCalledTimes(2);
  });

  it("updates apply mode setting from the sidebar control", () => {
    renderSidebar();

    fireEvent.click(screen.getByTestId("apply-mode-manual"));

    expect(updateSettingsMock).toHaveBeenCalledWith({
      autoApproveChanges: false,
    });
  });

  it("signs out from sidebar", () => {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "token-1");
    window.localStorage.setItem(DEV_USER_EMAIL_STORAGE_KEY, "dev@example.com");
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));

    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEV_USER_EMAIL_STORAGE_KEY)).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });
});
