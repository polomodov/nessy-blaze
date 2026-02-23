import fs from "node:fs";
import { z } from "zod";
import { log } from "@/lib/logger";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { gitRemove } from "@/ipc/utils/git_utils";

const logger = log.scope("delete_file");

const deleteFileSchema = z.object({
  path: z.string().describe("The file path to delete"),
});

export const deleteFileTool: ToolDefinition<z.infer<typeof deleteFileSchema>> =
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    inputSchema: deleteFileSchema,
    defaultConsent: "always",
    modifiesState: true,

    getConsentPreview: (args) => `Delete ${args.path}`,

    buildXml: (args, _isComplete) => {
      if (!args.path) return undefined;
      return `<blaze-delete path="${escapeXmlAttr(args.path)}"></blaze-delete>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const fullFilePath = safeJoin(ctx.appPath, args.path);

      if (fs.existsSync(fullFilePath)) {
        if (fs.lstatSync(fullFilePath).isDirectory()) {
          fs.rmdirSync(fullFilePath, { recursive: true });
        } else {
          fs.unlinkSync(fullFilePath);
        }
        logger.log(`Successfully deleted file: ${fullFilePath}`);

        // Remove from git
        try {
          await gitRemove({ path: ctx.appPath, filepath: args.path });
        } catch (error) {
          logger.warn(`Failed to git remove deleted file ${args.path}:`, error);
        }
      } else {
        logger.warn(`File to delete does not exist: ${fullFilePath}`);
      }

      return `Successfully deleted ${args.path}`;
    },
  };
