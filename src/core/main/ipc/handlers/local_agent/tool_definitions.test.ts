import { describe, expect, it } from "vitest";
import {
  TOOL_DEFINITIONS,
  getAgentToolConsent,
  getAllAgentToolConsents,
  getDefaultConsent,
  setAgentToolConsent,
} from "./tool_definitions";

describe("agent tool consent defaults", () => {
  it("uses tool definition defaults when no override is set", () => {
    const tool = TOOL_DEFINITIONS[0];
    expect(tool).toBeDefined();
    expect(getDefaultConsent(tool.name)).toBe(tool.defaultConsent ?? "ask");
    expect(getAgentToolConsent(tool.name)).toBe(tool.defaultConsent ?? "ask");
  });

  it("keeps consent overrides in the local agent consent store", () => {
    const tool =
      TOOL_DEFINITIONS.find((entry) => entry.defaultConsent !== "never") ??
      TOOL_DEFINITIONS[0];
    expect(tool).toBeDefined();

    setAgentToolConsent(tool.name, "always");

    expect(getAgentToolConsent(tool.name)).toBe("always");
    expect(getAllAgentToolConsents()[tool.name]).toBe("always");
  });
});
