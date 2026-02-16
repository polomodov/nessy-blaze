import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlazeSidebar } from "./BlazeSidebar";

describe("BlazeSidebar", () => {
  it("calls onSelectPage when a page item is clicked", () => {
    const onSelectPage = vi.fn();

    render(
      <BlazeSidebar
        activePageId={null}
        collapsed={false}
        isDarkMode={false}
        onToggleTheme={vi.fn()}
        onToggleCollapse={vi.fn()}
        onSelectPage={onSelectPage}
        onNewProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Landing" }));

    expect(onSelectPage).toHaveBeenCalledWith("1-1", "1");
  });

  it("calls onNewProject when new project button is clicked", () => {
    const onNewProject = vi.fn();

    render(
      <BlazeSidebar
        activePageId={null}
        collapsed={false}
        isDarkMode={false}
        onToggleTheme={vi.fn()}
        onToggleCollapse={vi.fn()}
        onSelectPage={vi.fn()}
        onNewProject={onNewProject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleTheme when theme button is clicked", () => {
    const onToggleTheme = vi.fn();

    render(
      <BlazeSidebar
        activePageId={null}
        collapsed={false}
        isDarkMode={false}
        onToggleTheme={onToggleTheme}
        onToggleCollapse={vi.fn()}
        onSelectPage={vi.fn()}
        onNewProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });
});
