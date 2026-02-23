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
