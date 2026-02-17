import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isGitStatusClean } from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";

const mockDugiteExec = vi.fn();

vi.mock("dugite", async () => {
  const actual = await vi.importActual<typeof import("dugite")>("dugite");
  return {
    ...actual,
    exec: (...args: unknown[]) => mockDugiteExec(...args),
  };
});

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

describe("git_utils native git path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSettings).mockReturnValue({ enableNativeGit: true } as any);
  });

  it("throws a clear error when the project directory does not exist", async () => {
    const missingPath = path.join(
      os.tmpdir(),
      `blaze-missing-project-${Date.now()}`,
    );

    await expect(isGitStatusClean({ path: missingPath })).rejects.toThrow(
      `Project directory does not exist: ${missingPath}.`,
    );
    expect(mockDugiteExec).not.toHaveBeenCalled();
  });

  it("runs dugite when the project directory exists", async () => {
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "blaze-existing-project-"),
    );
    mockDugiteExec.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    try {
      await expect(isGitStatusClean({ path: projectPath })).resolves.toBe(true);
      expect(mockDugiteExec).toHaveBeenCalledTimes(1);
      expect(mockDugiteExec.mock.calls[0]?.[0]).toEqual([
        "status",
        "--porcelain",
      ]);
      expect(mockDugiteExec.mock.calls[0]?.[1]).toBe(projectPath);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
