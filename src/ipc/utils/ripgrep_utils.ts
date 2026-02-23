/**
 * Shared utilities for ripgrep integration
 */

import path from "node:path";
import os from "node:os";

export const MAX_FILE_SEARCH_SIZE = 1024 * 1024;
export const RIPGREP_EXCLUDED_GLOBS = [
  "!node_modules/**",
  "!.git/**",
  "!.next/**",
];

/**
 * Get the path to the ripgrep executable.
 * Handles both development and packaged Electron app scenarios.
 */
export function getRgExecutablePath(): string {
  const isWindows = os.platform() === "win32";
  const executableName = isWindows ? "rg.exe" : "rg";
  return path.join(
    process.cwd(),
    "node_modules",
    "@vscode",
    "ripgrep",
    "bin",
    executableName,
  );
}
