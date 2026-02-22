/**
 * Shared utility for making fetch requests to the Blaze engine API.
 * Handles common headers including Authorization and X-Blaze-Request-Id.
 */

import { readSettings } from "@/main/settings";
import type { AgentContext } from "./types";

export const BLAZE_ENGINE_URL =
  process.env.BLAZE_ENGINE_URL ?? "https://engine.blaze.sh/v1";

export interface EngineFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to include */
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper for Blaze engine API calls.
 * Automatically adds Authorization and X-Blaze-Request-Id headers.
 *
 * @param ctx - The agent context containing the request ID
 * @param endpoint - The API endpoint path (e.g., "/tools/web-search")
 * @param options - Fetch options (method, body, additional headers, etc.)
 * @returns The fetch Response
 * @throws Error if Blaze Pro API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "blazeRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new Error("Blaze Pro API key is required");
  }

  const { headers: extraHeaders, ...restOptions } = options;

  return fetch(`${BLAZE_ENGINE_URL}${endpoint}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Blaze-Request-Id": ctx.blazeRequestId,
      ...extraHeaders,
    },
  });
}
