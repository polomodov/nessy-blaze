import fs from "node:fs";
import { z } from "zod";
import { log } from "@/lib/logger";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { applySearchReplace } from "../../../processors/search_replace_processor";

const readFile = fs.promises.readFile;
const logger = log.scope("search_replace");

const searchReplaceSchema = z.object({
  path: z.string().describe("The file path to edit"),
  search: z
    .string()
    .describe(
      "Content to search for in the file. This should match the existing code that will be replaced",
    ),
  replace: z
    .string()
    .describe("New content to replace the search content with"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the changes"),
});

export const searchReplaceTool: ToolDefinition<
  z.infer<typeof searchReplaceSchema>
> = {
  name: "search_replace",
  description:
    "Apply targeted search/replace edits to a file. This is the preferred tool for editing a file.",
  inputSchema: searchReplaceSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Edit ${args.path}`,

  buildXml: (args, isComplete) => {
    if (!args.path) return undefined;

    let xml = `<blaze-search-replace path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "")}">\n<<<<<<< SEARCH\n${args.search ?? ""}`;

    // Add separator and replace content if replace has started
    if (args.replace !== undefined) {
      xml += `\n=======\n${args.replace}`;
    }

    if (isComplete) {
      if (args.replace == undefined) {
        xml += "\n=======\n";
      }
      xml += "\n>>>>>>> REPLACE\n</blaze-search-replace>";
    }

    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const fullFilePath = safeJoin(ctx.appPath, args.path);

    if (!fs.existsSync(fullFilePath)) {
      throw new Error(`File does not exist: ${args.path}`);
    }

    const original = await readFile(fullFilePath, "utf8");
    // Construct the operations string in the expected format
    const operations = `<<<<<<< SEARCH\n${args.search}\n=======\n${args.replace}\n>>>>>>> REPLACE`;
    const result = applySearchReplace(original, operations);

    if (!result.success || typeof result.content !== "string") {
      throw new Error(
        `Failed to apply search-replace: ${result.error ?? "unknown"}`,
      );
    }

    fs.writeFileSync(fullFilePath, result.content);
    logger.log(`Successfully applied search-replace to: ${fullFilePath}`);

    return `Successfully applied edits to ${args.path}`;
  },
};
