import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearApiTemplatesCacheForTests,
  fetchApiTemplates,
  getAllTemplates,
} from "@/ipc/utils/template_utils";
import { localTemplatesData } from "@/shared/templates";

type MockFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

function buildFetchResponse(payload: unknown): MockFetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

describe("template_utils", () => {
  beforeEach(() => {
    clearApiTemplatesCacheForTests();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    clearApiTemplatesCacheForTests();
    vi.unstubAllGlobals();
  });

  it("converts API templates with explicit id/sourceUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse([
          {
            id: "starter/nextjs",
            sourceUrl: "https://example.com/starter/nextjs.zip",
            title: "Next.js",
            description: "API payload",
            imageUrl: "https://example.com/image.png",
          },
        ]),
      ),
    );

    const templates = await fetchApiTemplates();
    expect(templates).toEqual([
      {
        id: "starter/nextjs",
        title: "Next.js",
        description: "API payload",
        imageUrl: "https://example.com/image.png",
        sourceUrl: "https://example.com/starter/nextjs.zip",
        isOfficial: false,
      },
    ]);
  });

  it("trims id/sourceUrl values from API payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse([
          {
            id: " starter/react ",
            sourceUrl: " https://example.com/starter/react.zip ",
            title: "React Starter",
            description: "Modern payload",
            imageUrl: "https://example.com/react.png",
          },
        ]),
      ),
    );

    const templates = await fetchApiTemplates();
    expect(templates[0]).toMatchObject({
      id: "starter/react",
      sourceUrl: "https://example.com/starter/react.zip",
    });
  });

  it("filters out templates without id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildFetchResponse([
          {
            title: "Invalid",
            description: "Missing identifiers",
            imageUrl: "https://example.com/invalid.png",
          },
          {
            id: "starter/valid",
            title: "Valid",
            description: "Valid payload",
            imageUrl: "https://example.com/valid.png",
          },
        ]),
      ),
    );

    const templates = await fetchApiTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.id).toBe("starter/valid");
  });

  it("caches API templates and merges with local templates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      buildFetchResponse([
        {
          id: "starter/api-only",
          title: "API Only",
          description: "From API",
          imageUrl: "https://example.com/api-only.png",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchApiTemplates();
    const second = await fetchApiTemplates();
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const allTemplates = await getAllTemplates();
    expect(allTemplates).toHaveLength(localTemplatesData.length + 1);
    expect(
      allTemplates.some((template) => template.id === "starter/api-only"),
    ).toBe(true);
  });
});
