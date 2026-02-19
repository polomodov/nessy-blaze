import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { JSXOpeningElement } from "@babel/types";
import MagicString from "magic-string";
import path from "node:path";
import type { Plugin } from "vite";

const VALID_EXTENSIONS = new Set([".jsx", ".tsx"]);
const BLAZE_ID_ATTRIBUTE = "data-blaze-id";

function normalizeFileId(id: string): string {
  return id.split("?")[0];
}

function shouldTransformFile(fileId: string): boolean {
  return (
    VALID_EXTENSIONS.has(path.extname(fileId)) &&
    !fileId.includes("node_modules")
  );
}

function hasBlazeIdAttribute(node: JSXOpeningElement): boolean {
  return node.attributes.some((attribute) => {
    if (attribute.type !== "JSXAttribute") {
      return false;
    }
    if (attribute.name.type !== "JSXIdentifier") {
      return false;
    }
    return attribute.name.name === BLAZE_ID_ATTRIBUTE;
  });
}

export function blazeComponentTagger(): Plugin {
  return {
    name: "vite-plugin-blaze-component-tagger",
    apply: "serve",
    enforce: "pre",
    async transform(code, id) {
      try {
        const fileId = normalizeFileId(id);
        if (!shouldTransformFile(fileId)) {
          return null;
        }

        const ast = parse(code, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
        });
        const magicString = new MagicString(code);
        const relativeFilePath = path.relative(process.cwd(), fileId);

        traverse(ast, {
          JSXOpeningElement(pathNode) {
            try {
              const node = pathNode.node;
              if (node.name.type !== "JSXIdentifier" || node.name.end == null) {
                return;
              }

              if (hasBlazeIdAttribute(node)) {
                return;
              }

              const location = node.loc?.start;
              if (!location) {
                return;
              }

              const blazeId = `${relativeFilePath}:${location.line}:${location.column}`;
              magicString.appendLeft(
                node.name.end,
                ` ${BLAZE_ID_ATTRIBUTE}="${blazeId}"`,
              );
            } catch (error) {
              console.warn(
                `[blaze-component-tagger] Failed to process JSX node in ${id}:`,
                error,
              );
            }
          },
        });

        if (magicString.toString() === code) {
          return null;
        }

        return {
          code: magicString.toString(),
          map: magicString.generateMap({ hires: true }),
        };
      } catch (error) {
        console.warn(
          `[blaze-component-tagger] Failed to transform ${id}:`,
          error,
        );
        return null;
      }
    },
  };
}
