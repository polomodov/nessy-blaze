import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ipcHandle = vi.fn();

  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const txUpdateReturning = vi.fn();
  const txUpdateWhere = vi.fn(() => ({ returning: txUpdateReturning }));
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }));
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }));

  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ update: txUpdate }),
  );

  return {
    ipcHandle,
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    txUpdate,
    txUpdateSet,
    txUpdateWhere,
    txUpdateReturning,
    transaction,
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
    transaction: mocks.transaction,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { registerLanguageModelHandlers } from "@/ipc/handlers/language_model_handlers";

function getHandler(channel: string) {
  const entry = mocks.ipcHandle.mock.calls.find((call) => call[0] === channel);
  if (!entry) {
    throw new Error(`Handler not registered for channel: ${channel}`);
  }

  return entry[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
}

describe("language_model_handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerLanguageModelHandlers();
  });

  it("edits custom provider via async transaction returning() path", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: "custom::provider" }]);
    mocks.txUpdateReturning.mockResolvedValueOnce([{ id: "custom::provider" }]);

    const handler = getHandler("edit-custom-language-model-provider");
    const result = (await handler(
      {},
      {
        id: "provider",
        name: "My provider",
        apiBaseUrl: "https://example.com/v1",
        envVarName: "MY_PROVIDER_KEY",
        trustSelfSigned: true,
      },
    )) as {
      id: string;
      name: string;
      apiBaseUrl: string;
      trustSelfSigned: boolean;
    };

    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txUpdateReturning).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "provider",
      name: "My provider",
      apiBaseUrl: "https://example.com/v1",
      envVarName: "MY_PROVIDER_KEY",
      trustSelfSigned: true,
      type: "custom",
    });
  });
});
