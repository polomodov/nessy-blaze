import { normalizePath } from "/shared/normalizePath.ts";
import { log } from "/src/lib/logger.ts";

const logger = log.scope("blaze_tag_parser");

export function getBlazeWriteTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const blazeWriteRegex = /<blaze-write([^>]*)>([\s\S]*?)<\/blaze-write>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = blazeWriteRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1];
    let content = match[2].trim();

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = pathMatch[1];
      const description = descriptionMatch?.[1];

      const contentLines = content.split("\n");
      if (contentLines[0]?.startsWith("```")) {
        contentLines.shift();
      }
      if (contentLines[contentLines.length - 1]?.startsWith("```")) {
        contentLines.pop();
      }
      content = contentLines.join("\n");

      tags.push({ path: normalizePath(path), content, description });
    } else {
      logger.warn(
        "Found <blaze-write> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}

export function getBlazeRenameTags(fullResponse: string): {
  from: string;
  to: string;
}[] {
  const blazeRenameRegex =
    /<blaze-rename from="([^"]+)" to="([^"]+)"[^>]*>([\s\S]*?)<\/blaze-rename>/g;
  let match;
  const tags: { from: string; to: string }[] = [];
  while ((match = blazeRenameRegex.exec(fullResponse)) !== null) {
    tags.push({
      from: normalizePath(match[1]),
      to: normalizePath(match[2]),
    });
  }
  return tags;
}

export function getBlazeDeleteTags(fullResponse: string): string[] {
  const blazeDeleteRegex =
    /<blaze-delete path="([^"]+)"[^>]*>([\s\S]*?)<\/blaze-delete>/g;
  let match;
  const paths: string[] = [];
  while ((match = blazeDeleteRegex.exec(fullResponse)) !== null) {
    paths.push(normalizePath(match[1]));
  }
  return paths;
}

export function getBlazeAddDependencyTags(fullResponse: string): string[] {
  const blazeAddDependencyRegex =
    /<blaze-add-dependency packages="([^"]+)">[^<]*<\/blaze-add-dependency>/g;
  let match;
  const packages: string[] = [];
  while ((match = blazeAddDependencyRegex.exec(fullResponse)) !== null) {
    packages.push(...match[1].split(" "));
  }
  return packages;
}

export function getBlazeChatSummaryTag(fullResponse: string): string | null {
  const blazeChatSummaryRegex =
    /<blaze-chat-summary>([\s\S]*?)<\/blaze-chat-summary>/g;
  const match = blazeChatSummaryRegex.exec(fullResponse);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

export function getBlazeCommandTags(fullResponse: string): string[] {
  const blazeCommandRegex =
    /<blaze-command type="([^"]+)"[^>]*><\/blaze-command>/g;
  let match;
  const commands: string[] = [];

  while ((match = blazeCommandRegex.exec(fullResponse)) !== null) {
    commands.push(match[1]);
  }

  return commands;
}

export function getBlazeSearchReplaceTags(fullResponse: string): {
  path: string;
  content: string;
  description?: string;
}[] {
  const blazeSearchReplaceRegex =
    /<blaze-search-replace([^>]*)>([\s\S]*?)<\/blaze-search-replace>/gi;
  const pathRegex = /path="([^"]+)"/;
  const descriptionRegex = /description="([^"]+)"/;

  let match;
  const tags: { path: string; content: string; description?: string }[] = [];

  while ((match = blazeSearchReplaceRegex.exec(fullResponse)) !== null) {
    const attributesString = match[1] || "";
    let content = match[2].trim();

    const pathMatch = pathRegex.exec(attributesString);
    const descriptionMatch = descriptionRegex.exec(attributesString);

    if (pathMatch && pathMatch[1]) {
      const path = pathMatch[1];
      const description = descriptionMatch?.[1];

      // Handle markdown code fences if present
      const contentLines = content.split("\n");
      if (contentLines[0]?.startsWith("```")) {
        contentLines.shift();
      }
      if (contentLines[contentLines.length - 1]?.startsWith("```")) {
        contentLines.pop();
      }
      content = contentLines.join("\n");

      tags.push({ path: normalizePath(path), content, description });
    } else {
      logger.warn(
        "Found <blaze-search-replace> tag without a valid 'path' attribute:",
        match[0],
      );
    }
  }
  return tags;
}
