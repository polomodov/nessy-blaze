import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("defaults to Russian and persists language switch", async ({
  electronApp,
}) => {
  const page = await electronApp.firstWindow();

  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();

  await page.getByTestId("language-option-en").click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByPlaceholder("Describe what should be built..."),
  ).toBeVisible();
});
