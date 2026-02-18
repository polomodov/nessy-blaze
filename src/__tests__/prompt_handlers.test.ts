import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ipcHandle = vi.fn();

  const selectFrom = vi.fn();
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn();
  const deleteFn = vi.fn(() => ({ where: deleteWhere }));

  return {
    ipcHandle,
    select,
    selectFrom,
    insert,
    insertValues,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    deleteFn,
    deleteWhere,
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: mocks.ipcHandle,
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.deleteFn,
  },
}));

import { registerPromptHandlers } from "@/ipc/handlers/prompt_handlers";

function getHandler(channel: string) {
  const entry = mocks.ipcHandle.mock.calls.find((call) => call[0] === channel);
  if (!entry) {
    throw new Error(`Handler not registered for channel: ${channel}`);
  }

  return entry[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

describe("prompt_handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPromptHandlers();
  });

  it("creates a prompt via async returning() path", async () => {
    const createdAt = new Date("2026-02-18T00:00:00.000Z");
    const updatedAt = new Date("2026-02-18T00:00:00.000Z");
    mocks.insertReturning.mockResolvedValueOnce([
      {
        id: 17,
        title: "Prompt title",
        description: "Prompt description",
        content: "Prompt content",
        createdAt,
        updatedAt,
      },
    ]);

    const handler = getHandler("prompts:create");
    const result = (await handler(
      {},
      {
        title: "Prompt title",
        description: "Prompt description",
        content: "Prompt content",
      },
    )) as {
      id: number;
      title: string;
    };

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith({
      title: "Prompt title",
      description: "Prompt description",
      content: "Prompt content",
    });
    expect(result.id).toBe(17);
    expect(result.title).toBe("Prompt title");
  });

  it("lists prompts via async select().from() path", async () => {
    const createdAt = new Date("2026-02-18T00:00:00.000Z");
    const updatedAt = new Date("2026-02-18T00:00:00.000Z");
    mocks.selectFrom.mockResolvedValueOnce([
      {
        id: 1,
        title: "Existing prompt",
        description: null,
        content: "Prompt body",
        createdAt,
        updatedAt,
      },
    ]);

    const handler = getHandler("prompts:list");
    const result = (await handler({})) as Array<{ id: number; title: string }>;

    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 1,
        title: "Existing prompt",
        description: null,
        content: "Prompt body",
        createdAt,
        updatedAt,
      },
    ]);
  });
});
