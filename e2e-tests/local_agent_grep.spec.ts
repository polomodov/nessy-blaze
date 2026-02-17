import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the grep agent tool
 * Tests searching file contents with ripgrep in local-agent mode
 */

testSkipIfWindows("local-agent - grep search", async ({ po }) => {
  await po.setUpBlazePro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/grep-search");

  await po.page.getByTestId("blaze-grep").first().click();
  await po.page.getByTestId("blaze-grep").nth(1).click();
  await po.snapshotMessages();
  await expect(po.page.getByTestId("blaze-grep").first()).toMatchAriaSnapshot();
  await expect(po.page.getByTestId("blaze-grep").nth(1)).toMatchAriaSnapshot();
});
