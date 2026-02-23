import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { log } from "@/lib/logger";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { gitAdd, gitRemove } from "@/ipc/utils/git_utils";

const logger = log.scope("rename_file");

const renameFileSchema = z.object({
  from: z.string().describe("The current file path"),
  to: z.string().describe("The new file path"),
});

export const renameFileTool: ToolDefinition<z.infer<typeof renameFileSchema>> =
  {
    name: "rename_file",
    description: "Rename or move a file in the codebase",
    inputSchema: renameFileSchema,
    defaultConsent: "always",
    modifiesState: true,

    getConsentPreview: (args) => `Rename ${args.from} to ${args.to}`,

    buildXml: (args, _isComplete) => {
      if (!args.from || !args.to) return undefined;
      return `<blaze-rename from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}"></blaze-rename>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const fromFullPath = safeJoin(ctx.appPath, args.from);
      const toFullPath = safeJoin(ctx.appPath, args.to);

      // Ensure target directory exists
      const dirPath = path.dirname(toFullPath);
      fs.mkdirSync(dirPath, { recursive: true });

      if (fs.existsSync(fromFullPath)) {
        fs.renameSync(fromFullPath, toFullPath);
        logger.log(
          `Successfully renamed file: ${fromFullPath} -> ${toFullPath}`,
        );

        // Update git
        await gitAdd({ path: ctx.appPath, filepath: args.to });
        try {
          await gitRemove({ path: ctx.appPath, filepath: args.from });
        } catch (error) {
          logger.warn(`Failed to git remove old file ${args.from}:`, error);
        }
      } else {
        logger.warn(`Source file for rename does not exist: ${fromFullPath}`);
      }

      return `Successfully renamed ${args.from} to ${args.to}`;
    },
  };
