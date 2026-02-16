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

  it("throws for unsupported channels", async () => {
    await expect(
      invokeIpcChannelOverHttp("unknown-channel", []),
    ).rejects.toThrow("Unsupported channel: unknown-channel");
  });
});
