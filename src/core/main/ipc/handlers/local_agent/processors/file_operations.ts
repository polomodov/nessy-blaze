/**
 * Shared file operations for both XML-based (Build mode) and Tool-based (Local Agent) processing
 */

import { log } from "@/lib/logger";
import {
  gitCommit,
  gitAddAll,
  getGitUncommittedFiles,
} from "@/ipc/utils/git_utils";
import type { AgentContext } from "../tools/types";

const logger = log.scope("file_operations");

/**
 * Commit all changes
 */
export async function commitAllChanges(
  ctx: Pick<AgentContext, "appPath">,
  chatSummary?: string,
): Promise<{
  commitHash?: string;
}> {
  try {
    // Check for uncommitted changes
    const uncommittedFiles = await getGitUncommittedFiles({
      path: ctx.appPath,
    });
    const message = chatSummary
      ? `[blaze] ${chatSummary}`
      : `[blaze] (${uncommittedFiles.length} files changed)`;
    let commitHash: string | undefined;

    if (uncommittedFiles.length > 0) {
      await gitAddAll({ path: ctx.appPath });
      try {
        commitHash = await gitCommit({
          path: ctx.appPath,
          message: message,
        });
      } catch (error) {
        logger.error(
          `Failed to commit extra files: ${uncommittedFiles.join(", ")}`,
          error,
        );
      }
    }

    return {
      commitHash,
    };
  } catch (error) {
    logger.error(`Failed to commit changes: ${error}`);
    throw new Error(`Failed to commit changes: ${error}`);
  }
}
