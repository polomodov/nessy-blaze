import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AppWindow,
  CalendarClock,
  Flame,
  Folder,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { IpcClient } from "@/ipc/ipc_client";
import { getConfiguredTenantScope } from "@/ipc/backend_client";
import { TenantScopePicker } from "@/components/TenantScopePicker";

type WorkspaceProject = {
  id: number;
  title: string;
  createdAt: Date | null;
};

interface BlazeSidebarProps {
  activeProjectId: number | null;
  collapsed: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onToggleCollapse: () => void;
  onSelectProject: (projectId: number) => void;
  onNewProject: () => void;
}

const PROJECTS_QUERY_KEY = "workspace-project-history";

function normalizeProjectDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getDateLabel(value: Date | null): string {
  if (!value) {
    return "Unknown date";
  }

  const now = new Date();
  const isSameDate =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (isSameDate) {
    return "Today";
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === value.getFullYear() &&
    yesterday.getMonth() === value.getMonth() &&
    yesterday.getDate() === value.getDate();

  if (isYesterday) {
    return "Yesterday";
  }

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BlazeSidebar({
  activeProjectId,
  collapsed,
  isDarkMode,
  onToggleTheme,
  onToggleCollapse,
  onSelectProject,
  onNewProject,
}: BlazeSidebarProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(() => getConfiguredTenantScope());

  const projectsQuery = useQuery<
    { apps: Array<{ id: number; name: string; createdAt: unknown }> },
    Error
  >({
    queryKey: [PROJECTS_QUERY_KEY, scope.orgId, scope.workspaceId],
    queryFn: async () => IpcClient.getInstance().listApps(),
    meta: { showErrorToast: false },
  });

  const projects = useMemo<WorkspaceProject[]>(() => {
    const rawApps = projectsQuery.data?.apps ?? [];
    return rawApps
      .map((app) => ({
        id: app.id,
        title: app.name,
        createdAt: normalizeProjectDate(app.createdAt),
      }))
      .sort((left, right) => {
        const leftTs = left.createdAt?.getTime() ?? 0;
        const rightTs = right.createdAt?.getTime() ?? 0;
        return rightTs - leftTs;
      });
  }, [projectsQuery.data]);

  const filteredProjects = useMemo(() => {
    const searchQuery = query.trim().toLowerCase();
    if (!searchQuery) {
      return projects;
    }
    return projects.filter((project) =>
      project.title.toLowerCase().includes(searchQuery),
    );
  }, [projects, query]);

  const handleScopeChange = async () => {
    const nextScope = getConfiguredTenantScope();
    setScope(nextScope);
  };

  let previousDate = "";

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 288 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex h-full flex-shrink-0 flex-col overflow-hidden border-r border-border bg-card"
    >
      <div className="flex min-h-[57px] items-center justify-between border-b border-border px-3 py-3">
        <div
          className={`flex items-center gap-3 overflow-hidden ${
            collapsed ? "w-full justify-center" : "px-2"
          }`}
        >
          <button
            onClick={collapsed ? onToggleCollapse : undefined}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary"
            aria-label="Open workspace sidebar"
          >
            <Flame size={16} className="text-primary-foreground" />
          </button>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-foreground">
                Nessy Blaze
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                From idea to production
              </p>
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1 pt-3">
          <button
            onClick={() => {
              onToggleCollapse();
              setTimeout(onNewProject, 250);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:brightness-105"
            title="New project"
            aria-label="New project"
          >
            <Plus size={16} />
          </button>

          <div className="my-2 h-px w-6 bg-border" />

          {filteredProjects.slice(0, 8).map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                onClick={() => {
                  onSelectProject(project.id);
                  onToggleCollapse();
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
                title={project.title || `Project #${project.id}`}
                aria-label={project.title}
              >
                <Folder size={16} />
              </button>
            );
          })}

          <div className="flex-1" />

          <button
            onClick={onToggleTheme}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title={
              isDarkMode ? "Switch to light theme" : "Switch to dark theme"
            }
            aria-label={
              isDarkMode ? "Switch to light theme" : "Switch to dark theme"
            }
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            onClick={onToggleCollapse}
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title="Expand panel"
            aria-label="Expand panel"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 pt-3">
            <button
              onClick={onNewProject}
              className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-105 active:scale-[0.98]"
            >
              <Plus size={16} />
              New project
            </button>
          </div>

          <div className="px-3 pt-3">
            <TenantScopePicker onScopeChange={handleScopeChange} />
          </div>

          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Search size={14} className="text-muted-foreground" />
              <input
                type="text"
                placeholder="Search projects..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pt-3">
            {projectsQuery.isLoading ? (
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                Loading projects...
              </div>
            ) : projectsQuery.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Failed to load projects history
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                No projects found for this workspace
              </div>
            ) : (
              filteredProjects.map((project) => {
                const dateLabel = getDateLabel(project.createdAt);
                const shouldShowDate = dateLabel !== previousDate;
                previousDate = dateLabel;
                const isActive = project.id === activeProjectId;

                return (
                  <div key={project.id}>
                    {shouldShowDate && (
                      <p className="first:mt-0 mb-1 mt-3 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {dateLabel}
                      </p>
                    )}
                    <button
                      onClick={() => onSelectProject(project.id)}
                      className={`group mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                        isActive
                          ? "bg-muted text-foreground"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                    >
                      <Folder
                        size={14}
                        className="flex-shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1 truncate text-sm font-medium">
                        {project.title}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CalendarClock size={11} />
                        {project.createdAt
                          ? formatDistanceToNow(project.createdAt, {
                              addSuffix: true,
                            })
                          : "unknown"}
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border px-3 py-2">
            <button
              onClick={onToggleTheme}
              className="mb-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
              {isDarkMode ? "Light theme" : "Dark theme"}
            </button>

            <p className="mb-1 px-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Scope Summary
            </p>
            <div className="rounded-lg border border-border/80 px-2.5 py-2 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5">
                <AppWindow size={12} />
                <span>{projects.length} projects in scope</span>
              </div>
              <div className="truncate">
                {scope.orgId}/{scope.workspaceId}
              </div>
            </div>
          </div>
        </>
      )}
    </motion.aside>
  );
}
