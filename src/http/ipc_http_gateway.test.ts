import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invokeIpcChannelOverHttp } from "./ipc_http_gateway";

describe("invokeIpcChannelOverHttp", () => {
  it("returns app version from package.json", async () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    ) as {
      version: string;
    };

    const response = (await invokeIpcChannelOverHttp(
      "get-app-version",
      [],
    )) as {
      version: string;
    };

    expect(response.version).toBe(packageJson.version);
  });

  it("creates app via HTTP IPC gateway", async () => {
    const appName = `http-ipc-create-app-${Date.now()}`;

    const response = (await invokeIpcChannelOverHttp("create-app", [
      { name: appName },
    ])) as {
      app: {
        id: number;
        name: string;
      };
      chatId: number;
    };

    expect(response.app.id).toBeGreaterThan(0);
    expect(response.app.name).toBe(appName);
    expect(response.chatId).toBeGreaterThan(0);
  });

  it("throws for unsupported channels", async () => {
    await expect(
      invokeIpcChannelOverHttp("unknown-channel", []),
    ).rejects.toThrow("Unsupported channel: unknown-channel");
  });
});
