import { describe, expect, it } from "vitest";
import {
  buildPreviewUrl,
  extractPreviewPathsFromAppSource,
  getPreviewPathLabel,
} from "./preview_routes";

describe("extractPreviewPathsFromAppSource", () => {
  it("extracts route paths from react-router routes", () => {
    const source = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path={'/services'} element={<Services />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    `;

    expect(extractPreviewPathsFromAppSource(source)).toEqual([
      "/",
      "/about",
      "/contact",
      "/services",
    ]);
  });

  it("returns root path when no routes are found", () => {
    expect(extractPreviewPathsFromAppSource("const App = () => null;")).toEqual(
      ["/"],
    );
  });
});

describe("getPreviewPathLabel", () => {
  it("formats root path label as home", () => {
    expect(getPreviewPathLabel("/")).toBe("Home (/)");
  });

  it("keeps non-root paths unchanged", () => {
    expect(getPreviewPathLabel("/about")).toBe("/about");
  });
});

describe("buildPreviewUrl", () => {
  it("keeps base url for root path", () => {
    expect(buildPreviewUrl("http://localhost:5173", "/")).toBe(
      "http://localhost:5173",
    );
  });

  it("replaces pathname for non-root paths", () => {
    expect(buildPreviewUrl("http://localhost:5173/", "/about")).toBe(
      "http://localhost:5173/about",
    );
  });
});
