import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AppWindow,
  CalendarClock,
  Check,
  Flame,
  Folder,
  Pencil,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  X,
  LogOut,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ChangeApplyModeSelector } from "@/components/ChangeApplyModeSelector";
import { useI18n } from "@/contexts/I18nContext";
import { IpcClient } from "@/ipc/ipc_client";
import { getConfiguredTenantScope } from "@/ipc/backend_client";
import { getDateFnsLocale, getIntlLocaleCode } from "@/i18n/date_locale";
import { TenantScopePicker } from "@/components/TenantScopePicker";
import { clearStoredAuthContext } from "@/lib/auth_storage";
import {
  OAUTH2_CODE_VERIFIER_STORAGE_KEY,
  OAUTH2_STATE_STORAGE_KEY,
} from "@/lib/oauth2_flow";

type WorkspaceProject = {
  id: number;
  title: string;
  createdAt: Date | null;
};

interface BlazeSidebarProps {
  activeProjectId: number | null;
  collapsed: boolean;
  isDarkMode: boolean;
  projectsRefreshToken?: number;
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

function getDateLabel(
  value: Date | null,
  {
    unknownDateLabel,
    todayLabel,
    yesterdayLabel,
    localeCode,
  }: {
    unknownDateLabel: string;
    todayLabel: string;
    yesterdayLabel: string;
    localeCode: string;
  },
): string {
  if (!value) {
    return unknownDateLabel;
  }

  const now = new Date();
  const isSameDate =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (isSameDate) {
    return todayLabel;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === value.getFullYear() &&
    yesterday.getMonth() === value.getMonth() &&
    yesterday.getDate() === value.getDate();

  if (isYesterday) {
    return yesterdayLabel;
  }

  return value.toLocaleDateString(localeCode, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function resolveProjectActionError(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

export function BlazeSidebar({
  activeProjectId,
  collapsed,
  isDarkMode,
  projectsRefreshToken = 0,
  onToggleTheme,
  onToggleCollapse,
  onSelectProject,
  onNewProject,
}: BlazeSidebarProps) {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(() => getConfiguredTenantScope());
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<number | null>(
    null,
  );
  const [renamingProjectName, setRenamingProjectName] = useState("");
  const [projectActionError, setProjectActionError] = useState<string | null>(
    null,
  );
  const [isProjectActionPending, setIsProjectActionPending] = useState(false);
  const dateFnsLocale = useMemo(() => getDateFnsLocale(language), [language]);
  const intlLocaleCode = useMemo(() => getIntlLocaleCode(language), [language]);

  const projectsQuery = useQuery<
    { apps: Array<{ id: number; name: string; createdAt: unknown }> },
    Error
  >({
    queryKey: [
      PROJECTS_QUERY_KEY,
      scope.orgId,
      scope.workspaceId,
      projectsRefreshToken,
    ],
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

  const refreshProjects = async () => {
    await queryClient.invalidateQueries({
      queryKey: [PROJECTS_QUERY_KEY, scope.orgId, scope.workspaceId],
    });
  };

  const openCreateProjectForm = () => {
    onNewProject();
    setIsCreateProjectOpen(true);
    setNewProjectName("");
    setRenamingProjectId(null);
    setRenamingProjectName("");
    setProjectActionError(null);
  };

  const closeCreateProjectForm = () => {
    setIsCreateProjectOpen(false);
    setNewProjectName("");
    setProjectActionError(null);
  };

  const handleCreateProject = async () => {
    if (isProjectActionPending) {
      return;
    }

    const trimmedProjectName = newProjectName.trim();
    if (!trimmedProjectName) {
      setProjectActionError(t("sidebar.error.projectNameRequired"));
      return;
    }

    setIsProjectActionPending(true);
    setProjectActionError(null);

    try {
      const createResult = await IpcClient.getInstance().createApp({
        name: trimmedProjectName,
      });
      closeCreateProjectForm();
      await refreshProjects();
      onSelectProject(createResult.app.id);
    } catch (error) {
      setProjectActionError(
        resolveProjectActionError(
          error,
          t("sidebar.error.createProjectFailed"),
        ),
      );
    } finally {
      setIsProjectActionPending(false);
    }
  };

  const startRenameProject = (project: WorkspaceProject) => {
    setIsCreateProjectOpen(false);
    setNewProjectName("");
    setProjectActionError(null);
    setRenamingProjectId(project.id);
    setRenamingProjectName(project.title);
  };

  const cancelRenameProject = () => {
    setRenamingProjectId(null);
    setRenamingProjectName("");
    setProjectActionError(null);
  };

  const handleRenameProject = async (projectId: number) => {
    if (isProjectActionPending) {
      return;
    }

    const trimmedProjectName = renamingProjectName.trim();
    if (!trimmedProjectName) {
      setProjectActionError(t("sidebar.error.projectNameRequired"));
      return;
    }

    const project = projects.find((candidate) => candidate.id === projectId);
    if (project && project.title.trim() === trimmedProjectName) {
      cancelRenameProject();
      return;
    }

    setIsProjectActionPending(true);
    setProjectActionError(null);

    try {
      await IpcClient.getInstance().patchApp(projectId, {
        name: trimmedProjectName,
      });
      await refreshProjects();
      cancelRenameProject();
    } catch (error) {
      setProjectActionError(
        resolveProjectActionError(
          error,
          t("sidebar.error.renameProjectFailed"),
        ),
      );
    } finally {
      setIsProjectActionPending(false);
    }
  };

  const handleSignOut = () => {
    clearStoredAuthContext();
    window.sessionStorage.removeItem(OAUTH2_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(OAUTH2_CODE_VERIFIER_STORAGE_KEY);
    queryClient.clear();
    void navigate({ to: "/auth", replace: true });
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
            aria-label={t("sidebar.aria.open")}
          >
            <Flame size={16} className="text-primary-foreground" />
          </button>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-foreground">
                {t("sidebar.brand.title")}
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {t("sidebar.brand.subtitle")}
              </p>
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title={t("sidebar.title.collapse")}
            aria-label={t("sidebar.aria.collapse")}
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
              setTimeout(openCreateProjectForm, 250);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:brightness-105"
            title={t("sidebar.title.newProject")}
            aria-label={t("sidebar.aria.newProject")}
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
                title={
                  project.title ||
                  t("sidebar.projectFallback", { id: project.id })
                }
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
              isDarkMode
                ? t("sidebar.title.switchToLight")
                : t("sidebar.title.switchToDark")
            }
            aria-label={
              isDarkMode
                ? t("sidebar.aria.switchToLight")
                : t("sidebar.aria.switchToDark")
            }
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <LanguageSwitcher variant="compact" className="mb-1" />

          <button
            onClick={handleSignOut}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title={t("sidebar.title.signOut")}
            aria-label={t("sidebar.aria.signOut")}
          >
            <LogOut size={16} />
          </button>

          <button
            onClick={onToggleCollapse}
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            title={t("sidebar.title.expand")}
            aria-label={t("sidebar.aria.expand")}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 pt-3">
            <button
              onClick={openCreateProjectForm}
              disabled={isProjectActionPending}
              className="flex w-full items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-105 active:scale-[0.98]"
            >
              <Plus size={16} />
              {t("sidebar.button.newProject")}
            </button>
            {isCreateProjectOpen && (
              <form
                className="mt-2 space-y-2 rounded-lg border border-border/80 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateProject();
                }}
              >
                <input
                  data-testid="create-project-input"
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    if (projectActionError) {
                      setProjectActionError(null);
                    }
                  }}
                  autoFocus
                  placeholder={t("sidebar.input.newProjectName")}
                  className="w-full rounded-md border border-border/80 bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                  disabled={isProjectActionPending}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    data-testid="create-project-submit"
                    disabled={isProjectActionPending}
                    className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isProjectActionPending
                      ? t("sidebar.button.creatingProject")
                      : t("sidebar.button.createProject")}
                  </button>
                  <button
                    type="button"
                    data-testid="create-project-cancel"
                    disabled={isProjectActionPending}
                    onClick={closeCreateProjectForm}
                    className="rounded-md border border-border/80 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {t("sidebar.button.cancel")}
                  </button>
                </div>
              </form>
            )}
            {projectActionError && (
              <div
                className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
                role="alert"
              >
                {projectActionError}
              </div>
            )}
          </div>

          <div className="px-3 pt-3">
            <TenantScopePicker onScopeChange={handleScopeChange} />
          </div>

          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Search size={14} className="text-muted-foreground" />
              <input
                type="text"
                placeholder={t("sidebar.search.placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pt-3">
            {projectsQuery.isLoading ? (
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                {t("sidebar.loadingProjects")}
              </div>
            ) : projectsQuery.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {t("sidebar.failedProjects")}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                {t("sidebar.emptyProjects")}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const dateLabel = getDateLabel(project.createdAt, {
                  unknownDateLabel: t("sidebar.date.unknown"),
                  todayLabel: t("sidebar.date.today"),
                  yesterdayLabel: t("sidebar.date.yesterday"),
                  localeCode: intlLocaleCode,
                });
                const shouldShowDate = dateLabel !== previousDate;
                previousDate = dateLabel;
                const isActive = project.id === activeProjectId;
                const isRenaming = renamingProjectId === project.id;

                return (
                  <div key={project.id}>
                    {shouldShowDate && (
                      <p className="first:mt-0 mb-1 mt-3 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {dateLabel}
                      </p>
                    )}
                    {isRenaming ? (
                      <form
                        className="mb-0.5 flex items-center gap-1 rounded-lg border border-border/80 bg-background px-2 py-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleRenameProject(project.id);
                        }}
                      >
                        <Folder
                          size={14}
                          className="flex-shrink-0 text-muted-foreground"
                        />
                        <input
                          data-testid={`rename-project-input-${project.id}`}
                          value={renamingProjectName}
                          onChange={(event) => {
                            setRenamingProjectName(event.target.value);
                            if (projectActionError) {
                              setProjectActionError(null);
                            }
                          }}
                          autoFocus
                          className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
                          disabled={isProjectActionPending}
                        />
                        <button
                          type="submit"
                          data-testid={`rename-project-save-${project.id}`}
                          disabled={isProjectActionPending}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                          aria-label={t("sidebar.button.save")}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          data-testid={`rename-project-cancel-${project.id}`}
                          disabled={isProjectActionPending}
                          onClick={cancelRenameProject}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                          aria-label={t("sidebar.button.cancel")}
                        >
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <div
                        className={`group mb-0.5 flex items-center gap-1 rounded-lg px-2 py-2 transition-colors ${
                          isActive
                            ? "bg-muted text-foreground"
                            : "text-foreground hover:bg-surface-hover"
                        }`}
                      >
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          <Folder
                            size={14}
                            className="mt-0.5 flex-shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium leading-tight">
                              {project.title}
                            </span>
                            <span
                              data-testid={`project-time-${project.id}`}
                              className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"
                            >
                              <CalendarClock size={10} />
                              <span className="truncate">
                                {project.createdAt
                                  ? formatDistanceToNow(project.createdAt, {
                                      addSuffix: true,
                                      locale: dateFnsLocale,
                                    })
                                  : t("sidebar.projectTimeUnknown")}
                              </span>
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          data-testid={`rename-project-button-${project.id}`}
                          onClick={() => startRenameProject(project)}
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100"
                          aria-label={t("sidebar.button.renameProject")}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border px-3 py-2">
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={onToggleTheme}
                className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
                {isDarkMode
                  ? t("sidebar.theme.light")
                  : t("sidebar.theme.dark")}
              </button>
              <LanguageSwitcher variant="compact" />
            </div>
            <div className="mb-2 rounded-lg border border-border/80 p-1.5">
              <ChangeApplyModeSelector showToast={false} />
            </div>

            <p className="mb-1 px-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("sidebar.scope.title")}
            </p>
            <div className="rounded-lg border border-border/80 px-2.5 py-2 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5">
                <AppWindow size={12} />
                <span>
                  {t("sidebar.scope.projectsCount", { count: projects.length })}
                </span>
              </div>
              <div className="truncate">
                {scope.orgId}/{scope.workspaceId}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border/80 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <LogOut size={12} />
              {t("sidebar.button.signOut")}
            </button>
          </div>
        </>
      )}
    </motion.aside>
  );
}
