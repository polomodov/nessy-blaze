import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useTheme } from "@/contexts/ThemeContext";
import { BlazeChatArea } from "./BlazeChatArea";
import { BlazePreviewPanel } from "./BlazePreviewPanel";
import { BlazeSidebar } from "./BlazeSidebar";

export function BlazeWorkspace() {
  const { isDarkMode, setTheme } = useTheme();
  const [activePageId, setActivePageId] = useState<string | null>("1-1");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <BlazeSidebar
        activePageId={activePageId}
        collapsed={isSidebarCollapsed}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setTheme(isDarkMode ? "light" : "dark")}
        onToggleCollapse={() => setIsSidebarCollapsed((previous) => !previous)}
        onNewProject={() => {
          setActivePageId(null);
        }}
        onSelectPage={(pageId) => {
          setActivePageId(pageId);
        }}
      />

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={45} minSize={30} maxSize={70}>
          <BlazeChatArea />
        </Panel>
        <PanelResizeHandle className="w-1 cursor-col-resize bg-gray-200 transition-colors hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700" />
        <Panel defaultSize={55} minSize={30}>
          <BlazePreviewPanel activePageId={activePageId} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
