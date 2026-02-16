import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  ExternalLink,
  FileText,
  Flame,
  Folder,
  Globe,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
} from "lucide-react";

type PageStatus = "draft" | "generating" | "ready";

type WorkspacePage = {
  id: string;
  title: string;
  status: PageStatus;
};

type WorkspaceProject = {
  id: string;
  title: string;
  date: string;
  pages: WorkspacePage[];
};

const workspaceProjects: WorkspaceProject[] = [
  {
    id: "1",
    title: "Spring Cashback Campaign",
    date: "Today",
    pages: [
      { id: "1-1", title: "Landing", status: "ready" },
      { id: "1-2", title: "Terms", status: "ready" },
      { id: "1-3", title: "FAQ", status: "generating" },
    ],
  },
  {
    id: "2",
    title: "Premium Plan Update",
    date: "Today",
    pages: [
      { id: "2-1", title: "Product Page", status: "generating" },
      { id: "2-2", title: "Plan Comparison", status: "draft" },
    ],
  },
  {
    id: "3",
    title: "Refer a Friend",
    date: "Yesterday",
    pages: [
      { id: "3-1", title: "Campaign Page", status: "ready" },
      { id: "3-2", title: "Program Rules", status: "ready" },
    ],
  },
];

const companySites = [
  { id: "s1", name: "company.com", env: "prod" },
  { id: "s2", name: "business.company.com", env: "prod" },
  { id: "s3", name: "staging.company.com", env: "staging" },
  { id: "s4", name: "promo.company.com", env: "prod" },
];

const statusClassByPageStatus: Record<PageStatus, string> = {
  draft: "bg-muted-foreground/30",
  generating: "bg-primary",
  ready: "bg-emerald-400",
};

interface BlazeSidebarProps {
  activePageId: string | null;
  collapsed: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onToggleCollapse: () => void;
  onSelectPage: (pageId: string, projectId: string) => void;
  onNewProject: () => void;
}

function SiteSearchBlock() {
  const [query, setQuery] = useState("");
  const visibleSites = companySites.filter((site) =>
    site.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
        <Search size={12} className="text-muted-foreground" />
        <input
          type="text"
          placeholder="Search site..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <div className="max-h-28 overflow-y-auto scrollbar-thin">
        {visibleSites.map((site) => (
          <div
            key={site.id}
            className="group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Globe size={13} className="flex-shrink-0" />
            <span className="flex-1 truncate text-xs">{site.name}</span>
            <span
              className={`rounded px-1 py-0.5 text-[10px] ${
                site.env === "staging"
                  ? "bg-primary/20 text-primary-foreground"
                  : "bg-emerald-400/20 text-emerald-600"
              }`}
            >
              {site.env}
            </span>
            <ExternalLink
              size={11}
              className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BlazeSidebar({
  activePageId,
  collapsed,
  isDarkMode,
  onToggleTheme,
  onToggleCollapse,
  onSelectPage,
  onNewProject,
}: BlazeSidebarProps) {
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(["1"]),
  );

  const filteredProjects = workspaceProjects.filter(
    (project) =>
      project.title.toLowerCase().includes(query.toLowerCase()) ||
      project.pages.some((page) =>
        page.title.toLowerCase().includes(query.toLowerCase()),
      ),
  );

  const toggleProject = (id: string) => {
    setExpandedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

          {workspaceProjects.map((project) => {
            const hasActivePage = project.pages.some(
              (page) => page.id === activePageId,
            );
            return (
              <button
                key={project.id}
                onClick={onToggleCollapse}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  hasActivePage
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
                title={project.title}
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
            title={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
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
            {filteredProjects.map((project) => {
              const shouldShowDate = project.date !== previousDate;
              previousDate = project.date;
              const isExpanded = expandedProjects.has(project.id);
              const hasActivePage = project.pages.some(
                (page) => page.id === activePageId,
              );

              return (
                <div key={project.id}>
                  {shouldShowDate && (
                    <p className="first:mt-0 mb-1 mt-3 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {project.date}
                    </p>
                  )}

                  <button
                    onClick={() => toggleProject(project.id)}
                    className={`group mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                      hasActivePage && !isExpanded
                        ? "bg-muted text-foreground"
                        : "text-foreground hover:bg-surface-hover"
                    }`}
                  >
                    <motion.span
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex-shrink-0 text-muted-foreground"
                    >
                      <ChevronRight size={14} />
                    </motion.span>
                    <Folder size={14} className="flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm font-medium">
                      {project.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {project.pages.length}
                    </span>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {project.pages.map((page) => (
                          <button
                            key={page.id}
                            onClick={() => onSelectPage(page.id, project.id)}
                            className={`mb-0.5 flex w-full items-center gap-2 rounded-lg py-1.5 pl-10 pr-2 text-left transition-colors ${
                              activePageId === page.id
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                            }`}
                          >
                            <FileText size={13} className="flex-shrink-0" />
                            <span className="flex-1 truncate text-[13px]">
                              {page.title}
                            </span>
                            <span
                              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                                statusClassByPageStatus[page.status]
                              } ${
                                page.status === "generating"
                                  ? "animate-pulse-dot"
                                  : ""
                              }`}
                            />
                          </button>
                        ))}
                        <button className="mb-1 flex w-full items-center gap-2 rounded-lg py-1.5 pl-10 pr-2 text-left text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
                          <Plus size={13} className="flex-shrink-0" />
                          <span className="text-[13px]">Add page</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
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
              Company sites
            </p>
            <SiteSearchBlock />
          </div>
        </>
      )}
    </motion.aside>
  );
}
