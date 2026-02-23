import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { log } from "@/lib/logger";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { resolveFileUploadContent } from "./file_upload_utils";

const logger = log.scope("write_file");

const writeFileSchema = z.object({
  path: z.string().describe("The file path relative to the app root"),
  content: z.string().describe("The content to write to the file"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the change"),
});

export const writeFileTool: ToolDefinition<z.infer<typeof writeFileSchema>> = {
  name: "write_file",
  description: "Create or completely overwrite a file in the codebase",
  inputSchema: writeFileSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Write to ${args.path}`,

  buildXml: (args, isComplete) => {
    if (!args.path) return undefined;

    let xml = `<blaze-write path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "")}">\n${args.content ?? ""}`;
    if (isComplete) {
      xml += "\n</blaze-write>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const fullFilePath = safeJoin(ctx.appPath, args.path);

    // Resolve file upload IDs to actual content
    const resolved = await resolveFileUploadContent(args.content, ctx.chatId);
    const contentToWrite = resolved.content;

    // Ensure directory exists
    const dirPath = path.dirname(fullFilePath);
    fs.mkdirSync(dirPath, { recursive: true });

    // Write file content
    fs.writeFileSync(fullFilePath, contentToWrite);
    logger.log(`Successfully wrote file: ${fullFilePath}`);

    return `Successfully wrote ${args.path}`;
  },
};
