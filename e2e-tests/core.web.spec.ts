import { expect, test, type Page } from "@playwright/test";

async function loginViaPassword(page: Page) {
  await page.goto("/auth");
  await page.locator("#auth-email").fill("web-e2e@example.com");
  await page.locator("#auth-password").fill("password123");
  await page.locator("form").first().locator("button[type='submit']").click();
  await expect(page).toHaveURL(/\/$/);
}

async function createScopedChatForStream(page: Page): Promise<{
  orgId: string;
  workspaceId: string;
  chatId: number;
}> {
  const orgsResponse = await page.request.get("/api/v1/orgs");
  expect(orgsResponse.ok()).toBeTruthy();
  const orgsPayload = (await orgsResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const orgId = orgsPayload.data?.[0]?.id ?? "";
  expect(orgId.length > 0).toBeTruthy();

  const workspacesResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces`,
  );
  expect(workspacesResponse.ok()).toBeTruthy();
  const workspacesPayload = (await workspacesResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const workspaceId = workspacesPayload.data?.[0]?.id ?? "";
  expect(workspaceId.length > 0).toBeTruthy();

  const createAppResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: {
        name: `payload-contract-${Date.now()}`,
      },
    },
  );
  expect(createAppResponse.ok()).toBeTruthy();
  const createAppPayload = (await createAppResponse.json()) as {
    data?: { chatId?: number };
  };
  const chatId = createAppPayload.data?.chatId;
  expect(typeof chatId).toBe("number");

  return {
    orgId,
    workspaceId,
    chatId: chatId as number,
  };
}

async function resolveScopedTenant(page: Page): Promise<{
  orgId: string;
  workspaceId: string;
}> {
  const orgsResponse = await page.request.get("/api/v1/orgs");
  expect(orgsResponse.ok()).toBeTruthy();
  const orgsPayload = (await orgsResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const orgId = orgsPayload.data?.[0]?.id ?? "";
  expect(orgId.length > 0).toBeTruthy();

  const workspacesResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces`,
  );
  expect(workspacesResponse.ok()).toBeTruthy();
  const workspacesPayload = (await workspacesResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const workspaceId = workspacesPayload.data?.[0]?.id ?? "";
  expect(workspaceId.length > 0).toBeTruthy();

  return { orgId, workspaceId };
}

test("auth flow opens workspace", async ({ page }) => {
  await loginViaPassword(page);
  await expect(page.locator("textarea")).toBeVisible();
});

test("core chat handles canned stream prompt", async ({ page }) => {
  await loginViaPassword(page);

  const streamResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/chats/") &&
      response.url().includes("/stream"),
    {
      timeout: 45_000,
    },
  );

  const input = page.locator("textarea").first();
  await input.fill("[blaze-qa=write] create a hello file");
  await input.press("Enter");

  const streamResponse = await streamResponsePromise;
  expect(streamResponse.ok()).toBeTruthy();

  await expect(
    page.locator("[data-testid='workspace-chat-scroll']"),
  ).toContainText("[blaze-qa=write]", {
    timeout: 30_000,
  });
});

test("chat stream rejects unsupported payload keys in v1", async ({ page }) => {
  await loginViaPassword(page);
  const { orgId, workspaceId, chatId } = await createScopedChatForStream(page);

  const invalidResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/stream`,
    {
      data: {
        prompt: "Validate strict payload",
        unsupportedKey: true,
      },
    },
  );

  expect(invalidResponse.status()).toBe(400);
  await expect(
    invalidResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });
});

test("chat stream rejects invalid attachment objects in v1", async ({
  page,
}) => {
  await loginViaPassword(page);
  const { orgId, workspaceId, chatId } = await createScopedChatForStream(page);

  const invalidResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/stream`,
    {
      data: {
        prompt: "Validate attachment payload",
        attachments: [{ name: "README.md" }],
      },
    },
  );

  expect(invalidResponse.status()).toBe(400);
  await expect(
    invalidResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining(
      '"attachments" must be an array of valid attachment objects',
    ),
  });
});

test("core v1 app CRUD works via scoped HTTP API", async ({ page }) => {
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const invalidCreateResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: `invalid-create-${Date.now()}`, githubRepo: "legacy" },
    },
  );
  expect(invalidCreateResponse.status()).toBe(400);
  await expect(
    invalidCreateResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const createdName = `e2e-core-crud-${Date.now()}`;
  const createResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: createdName },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    data?: { app?: { id?: number; name?: string }; chatId?: number };
  };
  const appId = createPayload.data?.app?.id;
  expect(typeof appId).toBe("number");
  expect(createPayload.data?.app?.name).toBe(createdName);
  expect(typeof createPayload.data?.chatId).toBe("number");

  const listResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
  );
  expect(listResponse.ok()).toBeTruthy();
  const listPayload = (await listResponse.json()) as {
    data?: { apps?: Array<{ id?: number }> };
  };
  expect(listPayload.data?.apps?.some((app) => app.id === appId)).toBeTruthy();

  const updatedName = `${createdName}-renamed`;
  const patchResponse = await page.request.patch(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}`,
    {
      data: { name: updatedName, isFavorite: true },
    },
  );
  expect(patchResponse.ok()).toBeTruthy();
  const patchPayload = (await patchResponse.json()) as {
    data?: { id?: number; name?: string; isFavorite?: boolean };
  };
  expect(patchPayload.data?.id).toBe(appId);
  expect(patchPayload.data?.name).toBe(updatedName);
  expect(patchPayload.data?.isFavorite).toBe(true);

  const invalidPatchResponse = await page.request.patch(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}`,
    {
      data: { name: updatedName, appId },
    },
  );
  expect(invalidPatchResponse.status()).toBe(400);
  await expect(
    invalidPatchResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const getResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}`,
  );
  expect(getResponse.ok()).toBeTruthy();
  const getPayload = (await getResponse.json()) as {
    data?: { id?: number; name?: string; isFavorite?: boolean };
  };
  expect(getPayload.data?.id).toBe(appId);
  expect(getPayload.data?.name).toBe(updatedName);
  expect(getPayload.data?.isFavorite).toBe(true);

  const deleteResponse = await page.request.delete(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}`,
  );
  expect(deleteResponse.status()).toBe(204);

  const listAfterDeleteResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
  );
  expect(listAfterDeleteResponse.ok()).toBeTruthy();
  const listAfterDeletePayload = (await listAfterDeleteResponse.json()) as {
    data?: { apps?: Array<{ id?: number }> };
  };
  expect(
    listAfterDeletePayload.data?.apps?.some((app) => app.id === appId),
  ).toBe(false);
});

test("core v1 proposal lifecycle endpoints have deterministic contract", async ({
  page,
}) => {
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const createResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: `e2e-core-proposal-${Date.now()}` },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    data?: { chatId?: number };
  };
  const chatId = createPayload.data?.chatId;
  expect(typeof chatId).toBe("number");

  const proposalResponse = await page.request.get(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/proposal`,
  );
  expect(proposalResponse.ok()).toBeTruthy();
  const proposalPayload = (await proposalResponse.json()) as {
    data?: unknown;
  };
  expect(proposalPayload.data).toBeNull();

  const missingMessageId = 2_000_000_000;

  const unsupportedApprovePayloadResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/proposal/approve`,
    {
      data: {
        messageId: missingMessageId,
        chatId,
      },
    },
  );
  expect(unsupportedApprovePayloadResponse.status()).toBe(400);
  await expect(
    unsupportedApprovePayloadResponse.json() as Promise<
      Record<string, unknown>
    >,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidApproveResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/proposal/approve`,
    {
      data: { messageId: missingMessageId },
    },
  );
  expect(invalidApproveResponse.status()).toBe(500);
  await expect(
    invalidApproveResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("Assistant message not found"),
  });

  const invalidRejectResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}/proposal/reject`,
    {
      data: { messageId: missingMessageId },
    },
  );
  expect(invalidRejectResponse.status()).toBe(500);
  await expect(
    invalidRejectResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("Assistant message not found"),
  });
});

test("core v1 preview lifecycle run stop restart works via scoped HTTP API", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const createResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: `e2e-core-preview-${Date.now()}` },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    data?: { app?: { id?: number } };
  };
  const appId = createPayload.data?.app?.id;
  expect(typeof appId).toBe("number");

  const runResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/run`,
  );
  expect(runResponse.ok()).toBeTruthy();
  const runPayload = (await runResponse.json()) as {
    data?: { previewUrl?: string; originalUrl?: string };
  };
  expect(typeof runPayload.data?.previewUrl).toBe("string");
  expect(typeof runPayload.data?.originalUrl).toBe("string");
  expect(runPayload.data?.previewUrl).toMatch(/^https?:\/\//);
  expect(runPayload.data?.originalUrl).toMatch(/^https?:\/\//);

  const stopResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/stop`,
  );
  expect(stopResponse.status()).toBe(204);

  const restartResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/restart`,
    {
      data: { removeNodeModules: false },
    },
  );
  expect(restartResponse.ok()).toBeTruthy();
  const restartPayload = (await restartResponse.json()) as {
    data?: { success?: boolean; previewUrl?: string; originalUrl?: string };
  };
  expect(restartPayload.data?.success).toBe(true);
  expect(typeof restartPayload.data?.previewUrl).toBe("string");
  expect(typeof restartPayload.data?.originalUrl).toBe("string");
  expect(restartPayload.data?.previewUrl).toMatch(/^https?:\/\//);
  expect(restartPayload.data?.originalUrl).toMatch(/^https?:\/\//);

  const stopAfterRestartResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/stop`,
  );
  expect(stopAfterRestartResponse.status()).toBe(204);
});

test("preview restart rejects unsupported payload keys in v1", async ({
  page,
}) => {
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const createResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: `e2e-preview-restart-contract-${Date.now()}` },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    data?: { app?: { id?: number } };
  };
  const appId = createPayload.data?.app?.id;
  expect(typeof appId).toBe("number");

  const invalidResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/restart`,
    {
      data: {
        removeNodeModules: false,
        appId,
      },
    },
  );

  expect(invalidResponse.status()).toBe(400);
  await expect(
    invalidResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });
});

test("version and chat update endpoints reject unsupported payload keys in v1", async ({
  page,
}) => {
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const createResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps`,
    {
      data: { name: `e2e-version-chat-contract-${Date.now()}` },
    },
  );
  expect(createResponse.ok()).toBeTruthy();
  const createPayload = (await createResponse.json()) as {
    data?: { app?: { id?: number }; chatId?: number };
  };
  const appId = createPayload.data?.app?.id;
  const chatId = createPayload.data?.chatId;
  expect(typeof appId).toBe("number");
  expect(typeof chatId).toBe("number");

  const invalidCheckoutResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/versions/checkout`,
    {
      data: { versionId: "main", appId },
    },
  );
  expect(invalidCheckoutResponse.status()).toBe(400);
  await expect(
    invalidCheckoutResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidRevertResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/versions/revert`,
    {
      data: { previousVersionId: "main", appId },
    },
  );
  expect(invalidRevertResponse.status()).toBe(400);
  await expect(
    invalidRevertResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidUpdateChatResponse = await page.request.patch(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}/chats/${chatId}`,
    {
      data: { title: "Renamed", chatId },
    },
  );
  expect(invalidUpdateChatResponse.status()).toBe(400);
  await expect(
    invalidUpdateChatResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });
});

test("tenant org and workspace endpoints reject unsupported payload keys in v1", async ({
  page,
}) => {
  await loginViaPassword(page);
  const { orgId, workspaceId } = await resolveScopedTenant(page);

  const invalidCreateOrgResponse = await page.request.post("/api/v1/orgs", {
    data: {
      name: `invalid-org-${Date.now()}`,
      workspaceId,
    },
  });
  expect(invalidCreateOrgResponse.status()).toBe(400);
  await expect(
    invalidCreateOrgResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidPatchOrgResponse = await page.request.patch(
    `/api/v1/orgs/${orgId}`,
    {
      data: {
        name: `renamed-org-${Date.now()}`,
        orgId,
      },
    },
  );
  expect(invalidPatchOrgResponse.status()).toBe(400);
  await expect(
    invalidPatchOrgResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidCreateWorkspaceResponse = await page.request.post(
    `/api/v1/orgs/${orgId}/workspaces`,
    {
      data: {
        name: `invalid-ws-${Date.now()}`,
        orgId,
      },
    },
  );
  expect(invalidCreateWorkspaceResponse.status()).toBe(400);
  await expect(
    invalidCreateWorkspaceResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });

  const invalidPatchWorkspaceResponse = await page.request.patch(
    `/api/v1/orgs/${orgId}/workspaces/${workspaceId}`,
    {
      data: {
        name: `renamed-ws-${Date.now()}`,
        workspaceId,
      },
    },
  );
  expect(invalidPatchWorkspaceResponse.status()).toBe(400);
  await expect(
    invalidPatchWorkspaceResponse.json() as Promise<Record<string, unknown>>,
  ).resolves.toMatchObject({
    error: expect.stringContaining("unsupported keys"),
  });
});
