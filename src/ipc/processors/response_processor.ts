import { db } from "/src/db/index.ts";
import { chats, messages } from "/src/db/schema.ts";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import { getBlazeAppPath } from "/src/paths/paths.ts";
import path from "node:path";
import { safeJoin } from "/src/ipc/utils/path_utils.ts";

import { log } from "/src/lib/logger.ts";
import { executeAddDependency } from "/src/ipc/processors/executeAddDependency.ts";
import {
  gitCommit,
  gitAdd,
  gitRemove,
  gitAddAll,
  getGitUncommittedFiles,
  isGitStatusClean,
} from "/src/ipc/utils/git_utils.ts";
import {
  getBlazeWriteTags,
  getBlazeRenameTags,
  getBlazeDeleteTags,
  getBlazeAddDependencyTags,
  getBlazeSearchReplaceTags,
} from "/src/ipc/utils/blaze_tag_parser.ts";
import { applySearchReplace } from "/src/core/main/ipc/processors/search_replace_processor.ts";
import { FileUploadsState } from "/src/ipc/utils/file_uploads_state.ts";

const readFile = fs.promises.readFile;
const logger = log.scope("response_processor");

interface Output {
  message: string;
  error: unknown;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXmlContent(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toErrorString(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export async function dryRunSearchReplace({
  fullResponse,
  appPath,
}: {
  fullResponse: string;
  appPath: string;
}) {
  const issues: { filePath: string; error: string }[] = [];
  const blazeSearchReplaceTags = getBlazeSearchReplaceTags(fullResponse);
  for (const tag of blazeSearchReplaceTags) {
    const filePath = tag.path;
    const fullFilePath = safeJoin(appPath, filePath);
    try {
      if (!fs.existsSync(fullFilePath)) {
        issues.push({
          filePath,
          error: `Search-replace target file does not exist: ${filePath}`,
        });
        continue;
      }

      const original = await readFile(fullFilePath, "utf8");
      const result = applySearchReplace(original, tag.content);
      if (!result.success || typeof result.content !== "string") {
        issues.push({
          filePath,
          error:
            "Unable to apply search-replace to file because: " + result.error,
        });
        logger.warn(
          `Unable to apply search-replace to file ${filePath} because: ${result.error}. Original content:\n${original}\n Diff content:\n${tag.content}`,
        );
        continue;
      }
    } catch (error) {
      issues.push({
        filePath,
        error: error?.toString() ?? "Unknown error",
      });
    }
  }
  return issues;
}

export async function processFullResponseActions(
  fullResponse: string,
  chatId: number,
  {
    chatSummary,
    messageId,
  }: {
    chatSummary: string | undefined;
    messageId: number;
  },
): Promise<{
  updatedFiles?: boolean;
  error?: string;
  extraFiles?: string[];
  extraFilesError?: string;
}> {
  const fileUploadsState = FileUploadsState.getInstance();
  const fileUploadsMap = fileUploadsState.getFileUploadsForChat(chatId);
  fileUploadsState.clear(chatId);
  logger.log("processFullResponseActions for chatId", chatId);
  // Get the app associated with the chat
  const chatWithApp = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    with: {
      app: {
        columns: {
          path: true,
        },
      },
    },
  });
  if (!chatWithApp || !chatWithApp.app) {
    logger.error(`No app found for chat ID: ${chatId}`);
    return {};
  }

  const appPath = getBlazeAppPath(chatWithApp.app.path);
  const writtenFiles: string[] = [];
  const renamedFiles: string[] = [];
  const deletedFiles: string[] = [];
  let hasChanges = false;

  const errors: Output[] = [];
  const searchReplaceFailures: { filePath: string; error: string }[] = [];

  try {
    // Extract all tags
    const blazeWriteTags = getBlazeWriteTags(fullResponse);
    const blazeRenameTags = getBlazeRenameTags(fullResponse);
    const blazeDeletePaths = getBlazeDeleteTags(fullResponse);
    const blazeSearchReplaceTags = getBlazeSearchReplaceTags(fullResponse);
    const blazeAddDependencyPackages = getBlazeAddDependencyTags(fullResponse);

    const message = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.role, "assistant"),
        eq(messages.chatId, chatId),
      ),
    });

    if (!message) {
      logger.error(`No message found for ID: ${messageId}`);
      return {};
    }

    // TODO: Handle add dependency tags
    if (blazeAddDependencyPackages.length > 0) {
      try {
        await executeAddDependency({
          packages: blazeAddDependencyPackages,
          message: message,
          appPath,
        });
      } catch (error) {
        errors.push({
          message: `Failed to add dependencies: ${blazeAddDependencyPackages.join(
            ", ",
          )}`,
          error: error,
        });
      }
      writtenFiles.push("package.json");
      const pnpmFilename = "pnpm-lock.yaml";
      if (fs.existsSync(safeJoin(appPath, pnpmFilename))) {
        writtenFiles.push(pnpmFilename);
      }
      const packageLockFilename = "package-lock.json";
      if (fs.existsSync(safeJoin(appPath, packageLockFilename))) {
        writtenFiles.push(packageLockFilename);
      }
    }

    //////////////////////
    // File operations //
    // Do it in this order:
    // 1. Deletes
    // 2. Renames
    // 3. Writes
    //
    // Why?
    // - Deleting first avoids path conflicts before the other operations.
    // - LLMs like to rename and then edit the same file.
    //////////////////////

    // Process all file deletions
    for (const filePath of blazeDeletePaths) {
      const fullFilePath = safeJoin(appPath, filePath);

      // Delete the file if it exists
      if (fs.existsSync(fullFilePath)) {
        if (fs.lstatSync(fullFilePath).isDirectory()) {
          fs.rmdirSync(fullFilePath, { recursive: true });
        } else {
          fs.unlinkSync(fullFilePath);
        }
        logger.log(`Successfully deleted file: ${fullFilePath}`);
        deletedFiles.push(filePath);

        // Remove the file from git
        try {
          await gitRemove({ path: appPath, filepath: filePath });
        } catch (error) {
          logger.warn(`Failed to git remove deleted file ${filePath}:`, error);
          // Continue even if remove fails as the file was still deleted
        }
      } else {
        logger.warn(`File to delete does not exist: ${fullFilePath}`);
      }
    }

    // Process all file renames
    for (const tag of blazeRenameTags) {
      const fromPath = safeJoin(appPath, tag.from);
      const toPath = safeJoin(appPath, tag.to);

      // Ensure target directory exists
      const dirPath = path.dirname(toPath);
      fs.mkdirSync(dirPath, { recursive: true });

      // Rename the file
      if (fs.existsSync(fromPath)) {
        fs.renameSync(fromPath, toPath);
        logger.log(`Successfully renamed file: ${fromPath} -> ${toPath}`);
        renamedFiles.push(tag.to);

        // Add the new file and remove the old one from git
        await gitAdd({ path: appPath, filepath: tag.to });
        try {
          await gitRemove({ path: appPath, filepath: tag.from });
        } catch (error) {
          logger.warn(`Failed to git remove old file ${tag.from}:`, error);
          // Continue even if remove fails as the file was still renamed
        }
      } else {
        logger.warn(`Source file for rename does not exist: ${fromPath}`);
      }
    }

    // Process all search-replace edits
    for (const tag of blazeSearchReplaceTags) {
      const filePath = tag.path;
      const fullFilePath = safeJoin(appPath, filePath);

      try {
        if (!fs.existsSync(fullFilePath)) {
          const error = `Search-replace target file does not exist: ${filePath}`;
          searchReplaceFailures.push({ filePath, error });
          logger.warn(error);
          continue;
        }
        const original = await readFile(fullFilePath, "utf8");
        const result = applySearchReplace(original, tag.content);
        if (!result.success || typeof result.content !== "string") {
          const error = `Failed to apply search-replace to ${filePath}: ${result.error ?? "unknown"}`;
          searchReplaceFailures.push({ filePath, error });
          logger.warn(error);
          continue;
        }
        // Write modified content
        fs.writeFileSync(fullFilePath, result.content);
        writtenFiles.push(filePath);
      } catch (error) {
        searchReplaceFailures.push({
          filePath,
          error: `Error applying search-replace to ${filePath}: ${error?.toString() ?? "Unknown error"}`,
        });
        errors.push({
          message: `Error applying search-replace to ${filePath}`,
          error: error,
        });
      }
    }

    // Process all file writes
    for (const tag of blazeWriteTags) {
      const filePath = tag.path;
      let content: string | Buffer = tag.content;
      const fullFilePath = safeJoin(appPath, filePath);

      // Check if content (stripped of whitespace) exactly matches a file ID and replace with actual file content
      if (fileUploadsMap) {
        const trimmedContent = tag.content.trim();
        const fileInfo = fileUploadsMap.get(trimmedContent);
        if (fileInfo) {
          try {
            const fileContent = await readFile(fileInfo.filePath);
            content = fileContent;
            logger.log(
              `Replaced file ID ${trimmedContent} with content from ${fileInfo.originalName}`,
            );
          } catch (error) {
            logger.error(
              `Failed to read uploaded file ${fileInfo.originalName}:`,
              error,
            );
            errors.push({
              message: `Failed to read uploaded file: ${fileInfo.originalName}`,
              error: error,
            });
          }
        }
      }

      // Ensure directory exists
      const dirPath = path.dirname(fullFilePath);
      fs.mkdirSync(dirPath, { recursive: true });

      // Write file content
      fs.writeFileSync(fullFilePath, content);
      logger.log(`Successfully wrote file: ${fullFilePath}`);
      writtenFiles.push(filePath);
    }

    // If we have any file changes, commit them all at once
    hasChanges =
      writtenFiles.length > 0 ||
      renamedFiles.length > 0 ||
      deletedFiles.length > 0 ||
      blazeAddDependencyPackages.length > 0;

    let uncommittedFiles: string[] = [];
    let extraFilesError: string | undefined;

    if (hasChanges) {
      // Stage all written files
      for (const file of writtenFiles) {
        await gitAdd({ path: appPath, filepath: file });
      }

      const isCleanAfterApply = await isGitStatusClean({ path: appPath });
      if (isCleanAfterApply) {
        logger.info(
          "No git changes detected after applying AI response, skipping commit",
        );
        hasChanges = false;
      }

      if (!hasChanges) {
        // No effective changes after staging (e.g. identical content rewrites).
        // Continue to approve the message without treating this as an error.
        logger.log("Skipping commit because repository is clean");
      } else {
        // Create commit with details of all changes
        const changes = [];
        if (writtenFiles.length > 0)
          changes.push(`wrote ${writtenFiles.length} file(s)`);
        if (renamedFiles.length > 0)
          changes.push(`renamed ${renamedFiles.length} file(s)`);
        if (deletedFiles.length > 0)
          changes.push(`deleted ${deletedFiles.length} file(s)`);
        if (blazeAddDependencyPackages.length > 0)
          changes.push(
            `added ${blazeAddDependencyPackages.join(", ")} package(s)`,
          );

        let message = chatSummary
          ? `[blaze] ${chatSummary} - ${changes.join(", ")}`
          : `[blaze] ${changes.join(", ")}`;
        // Use chat summary, if provided, or default for commit message
        let commitHash = await gitCommit({
          path: appPath,
          message,
        });
        logger.log(`Successfully committed changes: ${changes.join(", ")}`);

        // Check for any uncommitted changes after the commit
        uncommittedFiles = await getGitUncommittedFiles({ path: appPath });

        if (uncommittedFiles.length > 0) {
          // Stage all changes
          await gitAddAll({ path: appPath });
          try {
            commitHash = await gitCommit({
              path: appPath,
              message: message + " + extra files edited outside of Blaze",
              amend: true,
            });
            logger.log(
              `Amend commit with changes outside of blaze: ${uncommittedFiles.join(", ")}`,
            );
          } catch (error) {
            // Just log, but don't throw an error because the user can still
            // commit these changes outside of Blaze if needed.
            logger.error(
              `Failed to commit changes outside of blaze: ${uncommittedFiles.join(
                ", ",
              )}`,
            );
            extraFilesError = (error as any).toString();
          }
        }

        // Save the commit hash to the message
        await db
          .update(messages)
          .set({
            commitHash: commitHash,
          })
          .where(eq(messages.id, messageId));
      }
    }

    if (!hasChanges && searchReplaceFailures.length > 0) {
      const searchReplaceError = `Failed to apply search-replace edits: ${searchReplaceFailures
        .map(({ filePath, error }) => `${filePath}: ${error}`)
        .join(" | ")}`;
      errors.push({
        message: "Search-replace apply failed",
        error: searchReplaceError,
      });
      logger.warn(searchReplaceError);
      return {
        updatedFiles: false,
        error: searchReplaceError,
      };
    }

    logger.log("mark as approved: hasChanges", hasChanges);
    // Update the message to approved
    await db
      .update(messages)
      .set({
        approvalState: "approved",
      })
      .where(eq(messages.id, messageId));

    return {
      updatedFiles: hasChanges,
      extraFiles: uncommittedFiles.length > 0 ? uncommittedFiles : undefined,
      extraFilesError,
    };
  } catch (error: unknown) {
    logger.error("Error processing files:", error);
    return { error: (error as any).toString() };
  } finally {
    const appendedParts: string[] = [];

    if (errors.length > 0) {
      appendedParts.push(
        ...errors.map(
          (error) =>
            `<blaze-output type="error" message="${escapeXmlAttr(error.message)}">${escapeXmlContent(toErrorString(error.error))}</blaze-output>`,
        ),
      );
    }

    if (appendedParts.length > 0) {
      await db
        .update(messages)
        .set({
          content: `${fullResponse}\n\n${appendedParts.join("\n")}`,
        })
        .where(eq(messages.id, messageId));
    }
  }
}
