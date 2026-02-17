import { cleanFullResponse } from "@/ipc/utils/cleanFullResponse";
import { describe, it, expect } from "vitest";

describe("cleanFullResponse", () => {
  it("should replace < characters in blaze-write attributes", () => {
    const input = `<blaze-write path="src/file.tsx" description="Testing <a> tags.">content</blaze-write>`;
    const expected = `<blaze-write path="src/file.tsx" description="Testing ＜a＞ tags.">content</blaze-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should replace < characters in multiple attributes", () => {
    const input = `<blaze-write path="src/<component>.tsx" description="Testing <div> tags.">content</blaze-write>`;
    const expected = `<blaze-write path="src/＜component＞.tsx" description="Testing ＜div＞ tags.">content</blaze-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle multiple nested HTML tags in a single attribute", () => {
    const input = `<blaze-write path="src/file.tsx" description="Testing <div> and <span> and <a> tags.">content</blaze-write>`;
    const expected = `<blaze-write path="src/file.tsx" description="Testing ＜div＞ and ＜span＞ and ＜a＞ tags.">content</blaze-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle complex example with mixed content", () => {
    const input = `
      BEFORE TAG
  <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</blaze-write>
AFTER TAG
    `;

    const expected = `
      BEFORE TAG
  <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use ＜a＞ tags.">
import React from 'react';
</blaze-write>
AFTER TAG
    `;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle other blaze tag types", () => {
    const input = `<blaze-rename from="src/<old>.tsx" to="src/<new>.tsx"></blaze-rename>`;
    const expected = `<blaze-rename from="src/＜old＞.tsx" to="src/＜new＞.tsx"></blaze-rename>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle blaze-delete tags", () => {
    const input = `<blaze-delete path="src/<component>.tsx"></blaze-delete>`;
    const expected = `<blaze-delete path="src/＜component＞.tsx"></blaze-delete>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should not affect content outside blaze tags", () => {
    const input = `Some text with <regular> HTML tags. <blaze-write path="test.tsx" description="With <nested> tags.">content</blaze-write> More <html> here.`;
    const expected = `Some text with <regular> HTML tags. <blaze-write path="test.tsx" description="With ＜nested＞ tags.">content</blaze-write> More <html> here.`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle empty attributes", () => {
    const input = `<blaze-write path="src/file.tsx">content</blaze-write>`;
    const expected = `<blaze-write path="src/file.tsx">content</blaze-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle attributes without < characters", () => {
    const input = `<blaze-write path="src/file.tsx" description="Normal description">content</blaze-write>`;
    const expected = `<blaze-write path="src/file.tsx" description="Normal description">content</blaze-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });
});
