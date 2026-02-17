import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for list_files tool
 */

testSkipIfWindows("local-agent - list_files", async ({ po }) => {
  await po.setUpBlazePro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/list-files-non-recursive");
  await po.sendPrompt("tc=local-agent/list-files-recursive");
  const listFiles1 = po.page.getByTestId("blaze-list-files").first();
  await listFiles1.click();
  await expect(listFiles1).toMatchAriaSnapshot();

  const listFiles2 = po.page.getByTestId("blaze-list-files").nth(1);
  await listFiles2.click();
  await expect(listFiles2).toMatchAriaSnapshot();
});
