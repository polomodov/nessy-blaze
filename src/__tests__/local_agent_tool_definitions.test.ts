import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@/core/main/ipc/handlers/local_agent/tool_definitions";

describe("local agent tool definitions", () => {
  it("does not include Supabase integration tools", () => {
    const toolNames = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(toolNames.has("add_integration")).toBe(false);
    expect(toolNames.has("execute_sql")).toBe(false);
    expect(toolNames.has("get_supabase_project_info")).toBe(false);
    expect(toolNames.has("get_supabase_table_schema")).toBe(false);
  });
});
