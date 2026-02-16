import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "@/components/SettingsList";

describe("SETTINGS_SECTIONS", () => {
  it("does not include telemetry section", () => {
    expect(SETTINGS_SECTIONS.some((section) => section.id === "telemetry")).toBe(
      false,
    );
  });
});
