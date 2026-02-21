import { describe, expect, it, vi } from "vitest";
import {
  cleanUpPortWithVerification,
  waitForPortToClose,
} from "./preview_port_cleanup";

describe("preview_port_cleanup", () => {
  it("skips kill when port is already closed", async () => {
    const isPortOpen = vi.fn().mockResolvedValue(false);
    const killPortFn = vi.fn();

    await cleanUpPortWithVerification({
      port: 32109,
      isPortOpen,
      killPortFn,
    });

    expect(killPortFn).not.toHaveBeenCalled();
  });

  it("kills and resolves when port closes after kill", async () => {
    const isPortOpen = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const killPortFn = vi.fn().mockResolvedValue(undefined);

    await cleanUpPortWithVerification({
      port: 32109,
      isPortOpen,
      killPortFn,
    });

    expect(killPortFn).toHaveBeenCalledWith(32109, "tcp");
  });

  it("waits for port to close after kill failure", async () => {
    const isPortOpen = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const killPortFn = vi.fn().mockRejectedValue(new Error("kill failed"));

    await cleanUpPortWithVerification({
      port: 32109,
      isPortOpen,
      killPortFn,
      timeoutMs: 100,
      pollIntervalMs: 1,
    });

    expect(killPortFn).toHaveBeenCalledWith(32109, "tcp");
  });

  it("throws when port remains open past timeout", async () => {
    const isPortOpen = vi.fn().mockResolvedValue(true);

    await expect(
      waitForPortToClose({
        port: 32109,
        isPortOpen,
        timeoutMs: 10,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow("Port 32109 is still in use after cleanup.");
  });
});
