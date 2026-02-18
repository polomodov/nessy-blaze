import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("scaffold index page", () => {
  it("does not render the MadeWithBlaze branding link", () => {
    const indexPath = path.resolve(
      process.cwd(),
      "scaffold",
      "src",
      "pages",
      "Index.tsx",
    );
    const content = fs.readFileSync(indexPath, "utf8");

    expect(content).not.toContain("MadeWithBlaze");
    expect(content).not.toContain("made-with-blaze");
  });
});
