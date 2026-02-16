import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlazePreviewPanel } from "./BlazePreviewPanel";

describe("BlazePreviewPanel", () => {
  it("shows empty state when no page is selected", () => {
    render(<BlazePreviewPanel activePageId={null} />);

    expect(screen.getByText("Page preview")).toBeTruthy();
    expect(
      screen.getByText("Select a page from the workspace or create one from chat."),
    ).toBeTruthy();
  });

  it("shows selected page details", () => {
    render(<BlazePreviewPanel activePageId="1-1" />);

    expect(screen.getByText("Spring Cashback Campaign")).toBeTruthy();
    expect(screen.getByText("Landing")).toBeTruthy();
    expect(screen.getByText("30% Cashback on Every Purchase")).toBeTruthy();
  });
});
