import path from "node:path";
import os from "node:os";

/**
 * Gets the base blaze-apps directory path (without a specific app subdirectory)
 */
export function getBlazeAppsBaseDirectory(): string {
  return path.join(os.homedir(), "blaze-apps");
}

export function getBlazeAppPath(appPath: string): string {
  // If appPath is already absolute, use it as-is
  if (path.isAbsolute(appPath)) {
    return appPath;
  }
  // Otherwise, use the default base path
  return path.join(getBlazeAppsBaseDirectory(), appPath);
}

export function getTypeScriptCachePath(): string {
  return path.join(getUserDataPath(), ".cache", "typescript-cache");
}

/**
 * Gets the user data path, handling both Electron and non-Electron environments
 * In Electron: returns the app's userData directory
 * In non-Electron: returns "./userData" in the current directory
 */

export function getUserDataPath(): string {
  return path.resolve("./userData");
}
