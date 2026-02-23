import { describe, expect, it } from "vitest";
import {
  parseOptionalAttachments,
  parseOptionalSelectedComponents,
} from "./chat_stream_payload_validation";

describe("chat_stream_payload_validation", () => {
  describe("parseOptionalAttachments", () => {
    it("returns undefined when payload is not provided", () => {
      expect(parseOptionalAttachments(undefined)).toBeUndefined();
    });

    it("parses valid attachments and normalizes required strings", () => {
      const parsed = parseOptionalAttachments([
        {
          name: "  README.md  ",
          type: "  text/markdown  ",
          data: "YmFzZTY0",
          attachmentType: "chat-context",
        },
      ]);

      expect(parsed).toEqual([
        {
          name: "README.md",
          type: "text/markdown",
          data: "YmFzZTY0",
          attachmentType: "chat-context",
        },
      ]);
    });

    it("returns null for invalid attachment shape", () => {
      expect(parseOptionalAttachments({})).toBeNull();
      expect(
        parseOptionalAttachments([
          {
            name: "README.md",
            data: "YmFzZTY0",
            attachmentType: "chat-context",
          },
        ]),
      ).toBeNull();
      expect(
        parseOptionalAttachments([
          {
            name: "README.md",
            type: "text/markdown",
            data: "YmFzZTY0",
            attachmentType: "chat-context",
            extra: true,
          },
        ]),
      ).toBeNull();
    });
  });

  describe("parseOptionalSelectedComponents", () => {
    it("returns undefined when payload is not provided", () => {
      expect(parseOptionalSelectedComponents(undefined)).toBeUndefined();
    });

    it("parses valid selected components", () => {
      const parsed = parseOptionalSelectedComponents([
        {
          id: "component-1",
          name: "Header",
          relativePath: "src/App.tsx",
          lineNumber: 12,
          columnNumber: 4,
          tagName: "header",
        },
      ]);

      expect(parsed).toEqual([
        {
          id: "component-1",
          name: "Header",
          relativePath: "src/App.tsx",
          lineNumber: 12,
          columnNumber: 4,
          tagName: "header",
          runtimeId: undefined,
          textPreview: undefined,
          domPath: undefined,
        },
      ]);
    });

    it("returns null for invalid selected component shape", () => {
      expect(parseOptionalSelectedComponents({})).toBeNull();
      expect(
        parseOptionalSelectedComponents([
          {
            id: "component-1",
          },
        ]),
      ).toBeNull();
      expect(
        parseOptionalSelectedComponents([
          {
            id: "component-1",
            name: "Header",
            relativePath: "src/App.tsx",
            lineNumber: 12,
            columnNumber: 4,
            extra: true,
          },
        ]),
      ).toBeNull();
    });
  });
});
