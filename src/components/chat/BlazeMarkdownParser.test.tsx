import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlazeMarkdownParser } from "./BlazeMarkdownParser";

vi.mock("./ChatInput", () => ({
  mapActionToButton: () => null,
}));
vi.mock("@/components/chat/monaco", () => ({}));

describe("BlazeMarkdownParser", () => {
  it("shows disabled notice for integration tags", () => {
    render(
      <BlazeMarkdownParser
        content={
          '<blaze-add-integration provider="Supabase">Connect app to Supabase</blaze-add-integration>'
        }
      />,
    );

    expect(
      screen.getByText(
        'Feature "integrations" is disabled in client-server mode.',
      ),
    ).toBeTruthy();
  });

  it("shows disabled notice for MCP tool tags", () => {
    render(
      <BlazeMarkdownParser
        content={
          '<blaze-mcp-tool-call server="demo" tool="search">Running...</blaze-mcp-tool-call>'
        }
      />,
    );

    expect(
      screen.getByText(
        'Feature "MCP tools" is disabled in client-server mode.',
      ),
    ).toBeTruthy();
  });

  it("shows disabled notice for Supabase metadata tags", () => {
    render(
      <BlazeMarkdownParser
        content={
          "<blaze-supabase-project-info>Project details</blaze-supabase-project-info>"
        }
      />,
    );

    expect(
      screen.getByText(
        'Feature "Supabase tooling" is disabled in client-server mode.',
      ),
    ).toBeTruthy();
  });
});
