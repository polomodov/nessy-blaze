import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useTheme } from "@/contexts/ThemeContext";
import { BlazeChatArea } from "./BlazeChatArea";
import { BlazePreviewPanel } from "./BlazePreviewPanel";
import { BlazeSidebar } from "./BlazeSidebar";

export function BlazeWorkspace() {
  const { isDarkMode, setTheme } = useTheme();
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);
  const [projectsRefreshToken, setProjectsRefreshToken] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <BlazeSidebar
        activeProjectId={activeProjectId}
        collapsed={isSidebarCollapsed}
        isDarkMode={isDarkMode}
        projectsRefreshToken={projectsRefreshToken}
        onToggleTheme={() => setTheme(isDarkMode ? "light" : "dark")}
        onToggleCollapse={() => setIsSidebarCollapsed((previous) => !previous)}
        onNewProject={() => {
          setActiveProjectId(null);
          setActiveAppId(null);
        }}
        onSelectProject={(projectId) => {
          setActiveProjectId(projectId);
          setActiveAppId(projectId);
        }}
      />

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={45} minSize={30} maxSize={70}>
          <BlazeChatArea
            activeAppId={activeAppId}
            onAppCreated={(appId) => {
              setActiveProjectId(appId);
              setActiveAppId(appId);
              setProjectsRefreshToken((previous) => previous + 1);
            }}
          />
        </Panel>
        <PanelResizeHandle className="w-1 cursor-col-resize bg-gray-200 transition-colors hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700" />
        <Panel defaultSize={55} minSize={30}>
          <BlazePreviewPanel activeAppId={activeAppId} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
