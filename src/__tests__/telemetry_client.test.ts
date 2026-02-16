import { describe, expect, it, vi } from "vitest";

const { mockPosthogClient } = vi.hoisted(() => ({
  mockPosthogClient: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}));

vi.mock("posthog-js", () => ({
  default: mockPosthogClient,
}));

import { getTelemetryClient } from "@/lib/telemetry_client";

describe("getTelemetryClient", () => {
  it("returns the PostHog singleton without initializing it", () => {
    const telemetryClient = getTelemetryClient() as unknown as {
      init: ReturnType<typeof vi.fn>;
    };

    expect(telemetryClient).toBe(mockPosthogClient);
    expect(telemetryClient.init).not.toHaveBeenCalled();
  });
});
