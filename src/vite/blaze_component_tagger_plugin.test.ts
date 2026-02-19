import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import { blazeComponentTagger } from "./blaze_component_tagger_plugin";

function normalize(value: string): string {
  return value.replace(/\\/g, "/");
}

function getTransformHandler(plugin: Plugin) {
  const transform = plugin.transform;
  if (!transform) {
    throw new Error("transform hook is not defined");
  }
  return typeof transform === "function" ? transform : transform.handler;
}

describe("blazeComponentTagger", () => {
  it("adds data-blaze-id to JSX elements in tsx files", async () => {
    const plugin = blazeComponentTagger();
    const transform = getTransformHandler(plugin);

    const id = path.join(process.cwd(), "src/components/example.tsx");
    const code = [
      "export function Example() {",
      "  return <div><span>Hello</span></div>;",
      "}",
    ].join("\n");

    const result = await transform.call({} as never, code, id);
    expect(result).not.toBeNull();
    if (
      !result ||
      typeof result === "string" ||
      typeof result.code !== "string"
    ) {
      throw new Error("Expected transform result object with code");
    }

    const transformedCode = normalize(result.code);
    expect(transformedCode).toContain(
      'data-blaze-id="src/components/example.tsx:2:9"',
    );
    expect(transformedCode).toContain(
      'data-blaze-id="src/components/example.tsx:2:14"',
    );
  });

  it("does not add duplicate data-blaze-id attribute", async () => {
    const plugin = blazeComponentTagger();
    const transform = getTransformHandler(plugin);

    const id = path.join(process.cwd(), "src/components/with_id.tsx");
    const code = [
      "export function WithId() {",
      '  return <div data-blaze-id="manual-id">Ready</div>;',
      "}",
    ].join("\n");

    const result = await transform.call({} as never, code, id);
    expect(result).toBeNull();
  });

  it("ignores non-jsx/tsx files and node_modules files", async () => {
    const plugin = blazeComponentTagger();
    const transform = getTransformHandler(plugin);

    const jsFileResult = await transform.call(
      {} as never,
      "export const value = 1;",
      path.join(process.cwd(), "src/lib/plain.ts"),
    );
    expect(jsFileResult).toBeNull();

    const nodeModulesResult = await transform.call(
      {} as never,
      "export const Component = () => <div />;",
      path.join(process.cwd(), "node_modules/pkg/index.tsx"),
    );
    expect(nodeModulesResult).toBeNull();
  });
});
