import { log } from "@/lib/logger";

const logger = log.scope("telemetry");

/**
 * Sends a telemetry event from the main process to the renderer,
 * where PostHog can capture it.
 */
export function sendTelemetryEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  logger.debug("telemetry:event", { eventName, properties });
}
