import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlazeSidebar } from "./BlazeSidebar";

const { listAppsMock } = vi.hoisted(() => ({
  listAppsMock: vi.fn(),
}));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      listApps: listAppsMock,
      listOrganizations: vi.fn().mockResolvedValue([]),
      listWorkspaces: vi.fn().mockResolvedValue([]),
    })),
  },
}));

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

  render(
    <QueryClientProvider client={queryClient}>
      <BlazeSidebar
        activeProjectId={null}
        collapsed={false}
        isDarkMode={false}
        onToggleTheme={vi.fn()}
        onToggleCollapse={vi.fn()}
        onSelectProject={vi.fn()}
        onNewProject={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("BlazeSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleTheme when theme button is clicked", () => {
    const onToggleTheme = vi.fn();

    renderSidebar({ onToggleTheme });

    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });
});
