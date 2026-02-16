import posthog, { type PostHog } from "posthog-js";

/**
 * Returns a non-initialized PostHog client so existing telemetry calls stay
 * no-op and do not emit network analytics events.
 */
export function getTelemetryClient(): PostHog {
  return posthog;
}
