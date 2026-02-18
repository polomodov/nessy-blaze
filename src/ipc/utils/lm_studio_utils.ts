export const LM_STUDIO_BASE_URL =
  process.env.LM_STUDIO_BASE_URL_FOR_TESTING ||
  process.env.LM_STUDIO_BASE_URL ||
  "http://localhost:1234";

type FetchLike = typeof fetch;

interface LmStudioModelDescriptor {
  id?: string;
  type?: string;
  state?: string;
}

interface LmStudioModelsResponse {
  data?: LmStudioModelDescriptor[];
}

export async function getPreferredLMStudioModelName({
  fetchImpl = fetch,
  baseUrl = LM_STUDIO_BASE_URL,
  timeoutMs = 1200,
}: {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<string | null> {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/api/v0/models`, {
      signal: abortController.signal,
    });
    if (!response.ok) {
      return null;
    }

    const responseBody = (await response.json()) as LmStudioModelsResponse;
    const llmModels = (responseBody.data ?? []).filter(
      (model) => model.type === "llm" && typeof model.id === "string",
    ) as Array<
      Required<Pick<LmStudioModelDescriptor, "id">> & LmStudioModelDescriptor
    >;
    if (llmModels.length === 0) {
      return null;
    }

    const loadedModel = llmModels.find((model) => model.state === "loaded");
    return loadedModel?.id ?? llmModels[0]?.id ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
