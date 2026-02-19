function normalizePreviewPath(rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return "/";
  }

  const withLeadingSlash = trimmedPath.startsWith("/")
    ? trimmedPath
    : `/${trimmedPath}`;
  const collapsedPath = withLeadingSlash.replace(/\/{2,}/g, "/");

  if (collapsedPath.length > 1 && collapsedPath.endsWith("/")) {
    return collapsedPath.slice(0, -1);
  }
  return collapsedPath;
}

function shouldIncludePreviewPath(pathValue: string): boolean {
  return pathValue.length > 0 && !pathValue.includes("*");
}

function sortPreviewPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => {
    if (left === "/" && right !== "/") {
      return -1;
    }
    if (left !== "/" && right === "/") {
      return 1;
    }
    return left.localeCompare(right);
  });
}

export function extractPreviewPathsFromAppSource(source: string): string[] {
  const routePattern =
    /<Route\b[^>]*\bpath\s*=\s*(?:\{["'`]([^"'`]+)["'`]\}|["'`]([^"'`]+)["'`])[^>]*>/gi;
  const previewPaths = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(source)) !== null) {
    const rawPath = match[1] ?? match[2] ?? "";
    const normalizedPath = normalizePreviewPath(rawPath);
    if (!shouldIncludePreviewPath(normalizedPath)) {
      continue;
    }
    previewPaths.add(normalizedPath);
  }

  if (previewPaths.size === 0) {
    return ["/"];
  }

  if (!previewPaths.has("/")) {
    previewPaths.add("/");
  }

  return sortPreviewPaths(Array.from(previewPaths));
}

export function getPreviewPathLabel(pathValue: string): string {
  if (pathValue === "/") {
    return "Home (/)";
  }
  return pathValue;
}

export function buildPreviewUrl(baseUrl: string, pathValue: string): string {
  const normalizedPath = normalizePreviewPath(pathValue);
  if (normalizedPath === "/") {
    return baseUrl;
  }

  try {
    const resolvedUrl = new URL(baseUrl);
    resolvedUrl.pathname = normalizedPath;
    resolvedUrl.search = "";
    resolvedUrl.hash = "";
    return resolvedUrl.toString();
  } catch {
    return baseUrl;
  }
}
