import { expect, test, type Page } from "@playwright/test";

async function loginViaPassword(page: Page) {
  await page.goto("/auth");
  await page.locator("#auth-email").fill("web-e2e@example.com");
  await page.locator("#auth-password").fill("password123");
  await page.locator("form").first().locator("button[type='submit']").click();
  await expect(page).toHaveURL(/\/$/);
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
