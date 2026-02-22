import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import { getBlazeAppPath } from "../../paths/paths";
import path from "node:path";
import { safeJoin } from "../utils/path_utils";

import log from "electron-log";
import { executeAddDependency } from "./executeAddDependency";
import {
  deleteSupabaseFunction,
  deploySupabaseFunction,
  executeSupabaseSql,
} from "../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
  deployAllSupabaseFunctions,
  extractFunctionNameFromPath,
} from "../../supabase_admin/supabase_utils";
import { UserSettings } from "../../lib/schemas";
import {
  gitCommit,
  gitAdd,
  gitRemove,
  gitAddAll,
  getGitUncommittedFiles,
  isGitStatusClean,
} from "../utils/git_utils";
import { readSettings } from "../../main/settings";
import { writeMigrationFile } from "../utils/file_utils";
import {
  getBlazeWriteTags,
  getBlazeRenameTags,
  getBlazeDeleteTags,
  getBlazeAddDependencyTags,
  getBlazeExecuteSqlTags,
  getBlazeSearchReplaceTags,
} from "../utils/blaze_tag_parser";
import { applySearchReplace } from "../../core/main/ipc/processors/search_replace_processor";
import { storeDbTimestampAtCurrentVersion } from "../utils/neon_timestamp_utils";

import { FileUploadsState } from "../utils/file_uploads_state";

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
      app: true,
    },
  });
  if (!chatWithApp || !chatWithApp.app) {
    logger.error(`No app found for chat ID: ${chatId}`);
    return {};
  }

  if (
    chatWithApp.app.neonProjectId &&
    chatWithApp.app.neonDevelopmentBranchId
  ) {
    try {
      await storeDbTimestampAtCurrentVersion({
        appId: chatWithApp.app.id,
      });
    } catch (error) {
      logger.error("Error creating Neon branch at current version:", error);
      throw new Error(
        "Could not create Neon branch; database versioning functionality is not working: " +
          error,
      );
    }
  }

  const settings: UserSettings = readSettings();
  const appPath = getBlazeAppPath(chatWithApp.app.path);
  const writtenFiles: string[] = [];
  const renamedFiles: string[] = [];
  const deletedFiles: string[] = [];
  let hasChanges = false;
  // Track if any shared modules were modified
  let sharedModulesChanged = false;

  const warnings: Output[] = [];
  const errors: Output[] = [];
  const searchReplaceFailures: { filePath: string; error: string }[] = [];

  try {
    // Extract all tags
    const blazeWriteTags = getBlazeWriteTags(fullResponse);
    const blazeRenameTags = getBlazeRenameTags(fullResponse);
    const blazeDeletePaths = getBlazeDeleteTags(fullResponse);
    const blazeSearchReplaceTags = getBlazeSearchReplaceTags(fullResponse);
    const blazeAddDependencyPackages = getBlazeAddDependencyTags(fullResponse);
    const blazeExecuteSqlQueries = chatWithApp.app.supabaseProjectId
      ? getBlazeExecuteSqlTags(fullResponse)
      : [];

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

    // Handle SQL execution tags
    if (blazeExecuteSqlQueries.length > 0) {
      for (const query of blazeExecuteSqlQueries) {
        try {
          await executeSupabaseSql({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            query: query.content,
            organizationSlug: chatWithApp.app.supabaseOrganizationSlug ?? null,
          });

          // Only write migration file if SQL execution succeeded
          if (settings.enableSupabaseWriteSqlMigration) {
            try {
              const migrationFilePath = await writeMigrationFile(
                appPath,
                query.content,
                query.description,
              );
              writtenFiles.push(migrationFilePath);
            } catch (error) {
              errors.push({
                message: `Failed to write SQL migration file for: ${query.description}`,
                error: error,
              });
            }
          }
        } catch (error) {
          errors.push({
            message: `Failed to execute SQL query: ${query.content}`,
            error: error,
          });
        }
      }
      logger.log(`Executed ${blazeExecuteSqlQueries.length} SQL queries`);
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

      // Track if this is a shared module
      if (isSharedServerModule(filePath)) {
        sharedModulesChanged = true;
      }

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
      // Only delete individual functions, not shared modules
      if (isServerFunction(filePath)) {
        try {
          await deleteSupabaseFunction({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: extractFunctionNameFromPath(filePath),
            organizationSlug: chatWithApp.app.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          errors.push({
            message: `Failed to delete Supabase function: ${filePath}`,
            error: error,
          });
        }
      }
    }

    // Process all file renames
    for (const tag of blazeRenameTags) {
      const fromPath = safeJoin(appPath, tag.from);
      const toPath = safeJoin(appPath, tag.to);

      // Track if this involves shared modules
      if (isSharedServerModule(tag.from) || isSharedServerModule(tag.to)) {
        sharedModulesChanged = true;
      }

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
      // Only handle individual functions, not shared modules
      if (isServerFunction(tag.from)) {
        try {
          await deleteSupabaseFunction({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: extractFunctionNameFromPath(tag.from),
            organizationSlug: chatWithApp.app.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          warnings.push({
            message: `Failed to delete Supabase function: ${tag.from} as part of renaming ${tag.from} to ${tag.to}`,
            error: error,
          });
        }
      }
      // Deploy renamed function (skip if shared modules changed - will be handled later)
      if (isServerFunction(tag.to) && !sharedModulesChanged) {
        try {
          await deploySupabaseFunction({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: extractFunctionNameFromPath(tag.to),
            appPath,
            organizationSlug: chatWithApp.app.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          errors.push({
            message: `Failed to deploy Supabase function: ${tag.to} as part of renaming ${tag.from} to ${tag.to}`,
            error: error,
          });
        }
      }
    }

    // Process all search-replace edits
    for (const tag of blazeSearchReplaceTags) {
      const filePath = tag.path;
      const fullFilePath = safeJoin(appPath, filePath);

      // Track if this is a shared module
      if (isSharedServerModule(filePath)) {
        sharedModulesChanged = true;
      }

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

        // If server function (not shared), redeploy (skip if shared modules changed)
        if (isServerFunction(filePath) && !sharedModulesChanged) {
          try {
            await deploySupabaseFunction({
              supabaseProjectId: chatWithApp.app.supabaseProjectId!,
              functionName: extractFunctionNameFromPath(filePath),
              appPath,
              organizationSlug:
                chatWithApp.app.supabaseOrganizationSlug ?? null,
            });
          } catch (error) {
            errors.push({
              message: `Failed to deploy Supabase function after search-replace: ${filePath}`,
              error: error,
            });
          }
        }
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

      // Track if this is a shared module
      if (isSharedServerModule(filePath)) {
        sharedModulesChanged = true;
      }

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
      // Deploy individual function (skip if shared modules changed - will be handled later)
      if (
        isServerFunction(filePath) &&
        typeof content === "string" &&
        !sharedModulesChanged
      ) {
        try {
          await deploySupabaseFunction({
            supabaseProjectId: chatWithApp.app.supabaseProjectId!,
            functionName: extractFunctionNameFromPath(filePath),
            appPath,
            organizationSlug: chatWithApp.app.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          errors.push({
            message: `Failed to deploy Supabase function: ${filePath}`,
            error: error,
          });
        }
      }
    }

    // If shared modules changed, redeploy all functions
    if (sharedModulesChanged && chatWithApp.app.supabaseProjectId) {
      try {
        logger.info(
          "Shared modules changed, redeploying all Supabase functions",
        );
        const deployErrors = await deployAllSupabaseFunctions({
          appPath,
          supabaseProjectId: chatWithApp.app.supabaseProjectId,
          supabaseOrganizationSlug:
            chatWithApp.app.supabaseOrganizationSlug ?? null,
        });
        if (deployErrors.length > 0) {
          for (const err of deployErrors) {
            errors.push({
              message:
                "Failed to deploy Supabase function after shared module change",
              error: err,
            });
          }
        }
      } catch (error) {
        errors.push({
          message:
            "Failed to redeploy all Supabase functions after shared module change",
          error: error,
        });
      }
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
        if (blazeExecuteSqlQueries.length > 0)
          changes.push(`executed ${blazeExecuteSqlQueries.length} SQL queries`);

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

    if (warnings.length > 0) {
      appendedParts.push(
        ...warnings.map(
          (warning) =>
            `<blaze-output type="warning" message="${escapeXmlAttr(warning.message)}">${escapeXmlContent(toErrorString(warning.error))}</blaze-output>`,
        ),
      );
    }
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
