// startProxy.js – helper to launch proxy.js as a worker

import { Worker } from "worker_threads";
import fs from "node:fs";
import path from "path";
import { findAvailablePort } from "./port_utils";
import log from "electron-log";

const logger = log.scope("start_proxy_server");

function resolveProxyServerWorkerPath(): string {
  const candidates = [
    // client-server/dev mode
    path.resolve(process.cwd(), "worker", "proxy_server.js"),
    // electron packaged/build mode (legacy behavior)
    path.resolve(__dirname, "..", "..", "worker", "proxy_server.js"),
    // ts/tsx source mode fallback
    path.resolve(__dirname, "..", "..", "..", "worker", "proxy_server.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `startProxy: proxy worker script not found. Checked: ${candidates.join(", ")}`,
  );
}

export async function startProxy(
  targetOrigin: string,
  opts: {
    // host?: string;
    // port?: number;
    // env?: Record<string, string>;
    onStarted?: (proxyUrl: string) => void;
  } = {},
) {
  if (!/^https?:\/\//.test(targetOrigin))
    throw new Error("startProxy: targetOrigin must be absolute http/https URL");
  const port = await findAvailablePort(50_000, 60_000);
  logger.info("Found available port", port);
  const {
    // host = "localhost",
    // env = {}, // additional env vars to pass to the worker
    onStarted,
  } = opts;

  const workerScriptPath = resolveProxyServerWorkerPath();
  logger.info("Using proxy worker script", workerScriptPath);

  const worker = new Worker(workerScriptPath, {
    workerData: {
      targetOrigin,
      port,
    },
  });

  worker.on("message", (m) => {
    logger.info("[proxy]", m);
    if (typeof m === "string" && m.startsWith("proxy-server-start url=")) {
      const url = m.substring("proxy-server-start url=".length);
      onStarted?.(url);
    }
  });
  worker.on("error", (e) => logger.error("[proxy] error:", e));
  worker.on("exit", (c) => logger.info("[proxy] exit", c));

  return worker; // let the caller keep a handle if desired
}
