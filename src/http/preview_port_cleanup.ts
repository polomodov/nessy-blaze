import killPort from "kill-port";

type IsPortOpenFn = (port: number) => Promise<boolean>;
type KillPortFn = (port: number, protocol?: "tcp" | "udp") => Promise<unknown>;

interface WaitForPortToCloseParams {
  port: number;
  isPortOpen: IsPortOpenFn;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForPortToClose({
  port,
  isPortOpen,
  timeoutMs = 5_000,
  pollIntervalMs = 100,
}: WaitForPortToCloseParams): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isPortOpen(port))) {
      return;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Port ${port} is still in use after cleanup.`);
}

interface CleanUpPortParams {
  port: number;
  isPortOpen: IsPortOpenFn;
  killPortFn?: KillPortFn;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function cleanUpPortWithVerification({
  port,
  isPortOpen,
  killPortFn = killPort,
  timeoutMs,
  pollIntervalMs,
}: CleanUpPortParams): Promise<void> {
  if (!(await isPortOpen(port))) {
    return;
  }

  try {
    await killPortFn(port, "tcp");
  } catch {
    // ignore kill errors and rely on observed port state below
  }

  if (!(await isPortOpen(port))) {
    return;
  }

  await waitForPortToClose({
    port,
    isPortOpen,
    timeoutMs,
    pollIntervalMs,
  });
}
