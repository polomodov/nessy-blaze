import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";

import { BlazeWrite } from "./BlazeWrite";
import { BlazeRename } from "./BlazeRename";
import { BlazeDelete } from "./BlazeDelete";
import { BlazeAddDependency } from "./BlazeAddDependency";
import { BlazeExecuteSql } from "./BlazeExecuteSql";
import { BlazeLogs } from "./BlazeLogs";
import { BlazeGrep } from "./BlazeGrep";
import { BlazeAddIntegration } from "./BlazeAddIntegration";
import { BlazeEdit } from "./BlazeEdit";
import { BlazeSearchReplace } from "./BlazeSearchReplace";
import { BlazeCodebaseContext } from "./BlazeCodebaseContext";
import { BlazeThink } from "./BlazeThink";
import { CodeHighlight } from "./CodeHighlight";
import { useAtomValue } from "jotai";
import { isStreamingByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { CustomTagState } from "./stateTypes";
import { BlazeOutput } from "./BlazeOutput";
import { BlazeProblemSummary } from "./BlazeProblemSummary";
import { BlazeMcpToolCall } from "./BlazeMcpToolCall";
import { BlazeMcpToolResult } from "./BlazeMcpToolResult";
import { BlazeWebSearchResult } from "./BlazeWebSearchResult";
import { BlazeWebSearch } from "./BlazeWebSearch";
import { BlazeWebCrawl } from "./BlazeWebCrawl";
import { BlazeCodeSearchResult } from "./BlazeCodeSearchResult";
import { BlazeCodeSearch } from "./BlazeCodeSearch";
import { BlazeRead } from "./BlazeRead";
import { BlazeListFiles } from "./BlazeListFiles";
import { BlazeDatabaseSchema } from "./BlazeDatabaseSchema";
import { BlazeSupabaseTableSchema } from "./BlazeSupabaseTableSchema";
import { BlazeSupabaseProjectInfo } from "./BlazeSupabaseProjectInfo";
import { BlazeStatus } from "./BlazeStatus";
import { mapActionToButton } from "./ChatInput";
import { SuggestedAction } from "@/lib/schemas";
import { FixAllErrorsButton } from "./FixAllErrorsButton";

const BLAZE_CUSTOM_TAGS = [
  "blaze-write",
  "blaze-rename",
  "blaze-delete",
  "blaze-add-dependency",
  "blaze-execute-sql",
  "blaze-read-logs",
  "blaze-add-integration",
  "blaze-output",
  "blaze-problem-report",
  "blaze-chat-summary",
  "blaze-edit",
  "blaze-grep",
  "blaze-search-replace",
  "blaze-codebase-context",
  "blaze-web-search-result",
  "blaze-web-search",
  "blaze-web-crawl",
  "blaze-code-search-result",
  "blaze-code-search",
  "blaze-read",
  "think",
  "blaze-command",
  "blaze-mcp-tool-call",
  "blaze-mcp-tool-result",
  "blaze-list-files",
  "blaze-database-schema",
  "blaze-supabase-table-schema",
  "blaze-supabase-project-info",
  "blaze-status",
];

interface BlazeMarkdownParserProps {
  content: string;
}

type CustomTagInfo = {
  tag: string;
  attributes: Record<string, string>;
  content: string;
  fullMatch: string;
  inProgress?: boolean;
};

type ContentPiece =
  | { type: "markdown"; content: string }
  | { type: "custom-tag"; tagInfo: CustomTagInfo };

const customLink = ({
  node: _node,
  ...props
}: {
  node?: any;
  [key: string]: any;
}) => (
  <a
    {...props}
    onClick={(e) => {
      const url = props.href;
      if (url) {
        e.preventDefault();
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }}
  />
);

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      components={{
        code: CodeHighlight,
        a: customLink,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

/**
 * Custom component to parse markdown content with Blaze-specific tags
 */
export const BlazeMarkdownParser: React.FC<BlazeMarkdownParserProps> = ({
  content,
}) => {
  const chatId = useAtomValue(selectedChatIdAtom);
  const isStreaming = useAtomValue(isStreamingByIdAtom).get(chatId!) ?? false;
  // Extract content pieces (markdown and custom tags)
  const contentPieces = useMemo(() => {
    return parseCustomTags(content);
  }, [content]);

  // Extract error messages and track positions
  const { errorMessages, lastErrorIndex, errorCount } = useMemo(() => {
    const errors: string[] = [];
    let lastIndex = -1;
    let count = 0;

    contentPieces.forEach((piece, index) => {
      if (
        piece.type === "custom-tag" &&
        piece.tagInfo.tag === "blaze-output" &&
        piece.tagInfo.attributes.type === "error"
      ) {
        const errorMessage = piece.tagInfo.attributes.message;
        if (errorMessage?.trim()) {
          errors.push(errorMessage.trim());
          count++;
          lastIndex = index;
        }
      }
    });

    return {
      errorMessages: errors,
      lastErrorIndex: lastIndex,
      errorCount: count,
    };
  }, [contentPieces]);

  return (
    <>
      {contentPieces.map((piece, index) => (
        <React.Fragment key={index}>
          {piece.type === "markdown"
            ? piece.content && (
                <ReactMarkdown
                  components={{
                    code: CodeHighlight,
                    a: customLink,
                  }}
                >
                  {piece.content}
                </ReactMarkdown>
              )
            : renderCustomTag(piece.tagInfo, { isStreaming })}
          {index === lastErrorIndex &&
            errorCount > 1 &&
            !isStreaming &&
            chatId && (
              <div className="mt-3 w-full flex">
                <FixAllErrorsButton
                  errorMessages={errorMessages}
                  chatId={chatId}
                />
              </div>
            )}
        </React.Fragment>
      ))}
    </>
  );
};

/**
 * Pre-process content to handle unclosed custom tags
 * Adds closing tags at the end of the content for any unclosed custom tags
 * Assumes the opening tags are complete and valid
 * Returns the processed content and a map of in-progress tags
 */
function preprocessUnclosedTags(content: string): {
  processedContent: string;
  inProgressTags: Map<string, Set<number>>;
} {
  let processedContent = content;
  // Map to track which tags are in progress and their positions
  const inProgressTags = new Map<string, Set<number>>();

  // For each tag type, check if there are unclosed tags
  for (const tagName of BLAZE_CUSTOM_TAGS) {
    // Count opening and closing tags
    const openTagPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "g");
    const closeTagPattern = new RegExp(`</${tagName}>`, "g");

    // Track the positions of opening tags
    const openingMatches: RegExpExecArray[] = [];
    let match;

    // Reset regex lastIndex to start from the beginning
    openTagPattern.lastIndex = 0;

    while ((match = openTagPattern.exec(processedContent)) !== null) {
      openingMatches.push({ ...match });
    }

    const openCount = openingMatches.length;
    const closeCount = (processedContent.match(closeTagPattern) || []).length;

    // If we have more opening than closing tags
    const missingCloseTags = openCount - closeCount;
    if (missingCloseTags > 0) {
      // Add the required number of closing tags at the end
      processedContent += Array(missingCloseTags)
        .fill(`</${tagName}>`)
        .join("");

      // Mark the last N tags as in progress where N is the number of missing closing tags
      const inProgressIndexes = new Set<number>();
      const startIndex = openCount - missingCloseTags;
      for (let i = startIndex; i < openCount; i++) {
        inProgressIndexes.add(openingMatches[i].index);
      }
      inProgressTags.set(tagName, inProgressIndexes);
    }
  }

  return { processedContent, inProgressTags };
}

/**
 * Parse the content to extract custom tags and markdown sections into a unified array
 */
function parseCustomTags(content: string): ContentPiece[] {
  const { processedContent, inProgressTags } = preprocessUnclosedTags(content);

  const tagPattern = new RegExp(
    `<(${BLAZE_CUSTOM_TAGS.join("|")})\\s*([^>]*)>(.*?)<\\/\\1>`,
    "gs",
  );

  const contentPieces: ContentPiece[] = [];
  let lastIndex = 0;
  let match;

  // Find all custom tags
  while ((match = tagPattern.exec(processedContent)) !== null) {
    const [fullMatch, tag, attributesStr, tagContent] = match;
    const startIndex = match.index;

    // Add the markdown content before this tag
    if (startIndex > lastIndex) {
      contentPieces.push({
        type: "markdown",
        content: processedContent.substring(lastIndex, startIndex),
      });
    }

    // Parse attributes
    const attributes: Record<string, string> = {};
    const attrPattern = /([\w-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attributesStr)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2];
    }

    // Check if this tag was marked as in progress
    const tagInProgressSet = inProgressTags.get(tag);
    const isInProgress = tagInProgressSet?.has(startIndex);

    // Add the tag info
    contentPieces.push({
      type: "custom-tag",
      tagInfo: {
        tag,
        attributes,
        content: tagContent,
        fullMatch,
        inProgress: isInProgress || false,
      },
    });

    lastIndex = startIndex + fullMatch.length;
  }

  // Add the remaining markdown content
  if (lastIndex < processedContent.length) {
    contentPieces.push({
      type: "markdown",
      content: processedContent.substring(lastIndex),
    });
  }

  return contentPieces;
}

function getState({
  isStreaming,
  inProgress,
}: {
  isStreaming?: boolean;
  inProgress?: boolean;
}): CustomTagState {
  if (!inProgress) {
    return "finished";
  }
  return isStreaming ? "pending" : "aborted";
}

/**
 * Render a custom tag based on its type
 */
function renderCustomTag(
  tagInfo: CustomTagInfo,
  { isStreaming }: { isStreaming: boolean },
): React.ReactNode {
  const { tag, attributes, content, inProgress } = tagInfo;

  switch (tag) {
    case "blaze-read":
      return (
        <BlazeRead
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </BlazeRead>
      );
    case "blaze-web-search":
      return (
        <BlazeWebSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeWebSearch>
      );
    case "blaze-web-crawl":
      return (
        <BlazeWebCrawl
          node={{
            properties: {},
          }}
        >
          {content}
        </BlazeWebCrawl>
      );
    case "blaze-code-search":
      return (
        <BlazeCodeSearch
          node={{
            properties: {
              query: attributes.query || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeCodeSearch>
      );
    case "blaze-code-search-result":
      return (
        <BlazeCodeSearchResult
          node={{
            properties: {},
          }}
        >
          {content}
        </BlazeCodeSearchResult>
      );
    case "blaze-web-search-result":
      return (
        <BlazeWebSearchResult
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeWebSearchResult>
      );
    case "think":
      return (
        <BlazeThink
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeThink>
      );
    case "blaze-write":
      return (
        <BlazeWrite
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeWrite>
      );

    case "blaze-rename":
      return (
        <BlazeRename
          node={{
            properties: {
              from: attributes.from || "",
              to: attributes.to || "",
            },
          }}
        >
          {content}
        </BlazeRename>
      );

    case "blaze-delete":
      return (
        <BlazeDelete
          node={{
            properties: {
              path: attributes.path || "",
            },
          }}
        >
          {content}
        </BlazeDelete>
      );

    case "blaze-add-dependency":
      return (
        <BlazeAddDependency
          node={{
            properties: {
              packages: attributes.packages || "",
            },
          }}
        >
          {content}
        </BlazeAddDependency>
      );

    case "blaze-execute-sql":
      return (
        <BlazeExecuteSql
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              description: attributes.description || "",
            },
          }}
        >
          {content}
        </BlazeExecuteSql>
      );

    case "blaze-read-logs":
      return (
        <BlazeLogs
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              time: attributes.time || "",
              type: attributes.type || "",
              level: attributes.level || "",
              count: attributes.count || "",
            },
          }}
        >
          {content}
        </BlazeLogs>
      );

    case "blaze-grep":
      return (
        <BlazeGrep
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
              query: attributes.query || "",
              include: attributes.include || "",
              exclude: attributes.exclude || "",
              "case-sensitive": attributes["case-sensitive"] || "",
              count: attributes.count || "",
            },
          }}
        >
          {content}
        </BlazeGrep>
      );

    case "blaze-add-integration":
      return (
        <BlazeAddIntegration
          node={{
            properties: {
              provider: attributes.provider || "",
            },
          }}
        >
          {content}
        </BlazeAddIntegration>
      );

    case "blaze-edit":
      return (
        <BlazeEdit
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeEdit>
      );

    case "blaze-search-replace":
      return (
        <BlazeSearchReplace
          node={{
            properties: {
              path: attributes.path || "",
              description: attributes.description || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeSearchReplace>
      );

    case "blaze-codebase-context":
      return (
        <BlazeCodebaseContext
          node={{
            properties: {
              files: attributes.files || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeCodebaseContext>
      );

    case "blaze-mcp-tool-call":
      return (
        <BlazeMcpToolCall
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </BlazeMcpToolCall>
      );

    case "blaze-mcp-tool-result":
      return (
        <BlazeMcpToolResult
          node={{
            properties: {
              serverName: attributes.server || "",
              toolName: attributes.tool || "",
            },
          }}
        >
          {content}
        </BlazeMcpToolResult>
      );

    case "blaze-output":
      return (
        <BlazeOutput
          type={attributes.type as "warning" | "error"}
          message={attributes.message}
        >
          {content}
        </BlazeOutput>
      );

    case "blaze-problem-report":
      return (
        <BlazeProblemSummary summary={attributes.summary}>
          {content}
        </BlazeProblemSummary>
      );

    case "blaze-chat-summary":
      // Don't render anything for blaze-chat-summary
      return null;

    case "blaze-command":
      if (attributes.type) {
        const action = {
          id: attributes.type,
        } as SuggestedAction;
        return <>{mapActionToButton(action)}</>;
      }
      return null;

    case "blaze-list-files":
      return (
        <BlazeListFiles
          node={{
            properties: {
              directory: attributes.directory || "",
              recursive: attributes.recursive || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeListFiles>
      );

    case "blaze-database-schema":
      return (
        <BlazeDatabaseSchema
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeDatabaseSchema>
      );

    case "blaze-supabase-table-schema":
      return (
        <BlazeSupabaseTableSchema
          node={{
            properties: {
              table: attributes.table || "",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeSupabaseTableSchema>
      );

    case "blaze-supabase-project-info":
      return (
        <BlazeSupabaseProjectInfo
          node={{
            properties: {
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeSupabaseProjectInfo>
      );

    case "blaze-status":
      return (
        <BlazeStatus
          node={{
            properties: {
              title: attributes.title || "Processing...",
              state: getState({ isStreaming, inProgress }),
            },
          }}
        >
          {content}
        </BlazeStatus>
      );

    default:
      return null;
  }
}
