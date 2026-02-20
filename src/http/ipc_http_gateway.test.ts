import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invokeIpcChannelOverHttp } from "./ipc_http_gateway";

const hasDatabaseUrl = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL,
);

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

  it("saves and reads uiLanguage in user settings", async () => {
    const initialSettings = (await invokeIpcChannelOverHttp(
      "get-user-settings",
      [],
    )) as {
      uiLanguage?: "ru" | "en";
    };
    const initialLanguage = initialSettings.uiLanguage ?? "ru";
    const nextLanguage: "ru" | "en" = initialLanguage === "en" ? "ru" : "en";

    const updatedSettings = (await invokeIpcChannelOverHttp(
      "set-user-settings",
      [{ uiLanguage: nextLanguage }],
    )) as {
      uiLanguage?: "ru" | "en";
    };
    expect(updatedSettings.uiLanguage).toBe(nextLanguage);

    const persistedSettings = (await invokeIpcChannelOverHttp(
      "get-user-settings",
      [],
    )) as {
      uiLanguage?: "ru" | "en";
    };
    expect(persistedSettings.uiLanguage).toBe(nextLanguage);

    await invokeIpcChannelOverHttp("set-user-settings", [
      { uiLanguage: initialLanguage },
    ]);
  });

  (hasDatabaseUrl ? it : it.skip)(
    "supports proposal channels over HTTP IPC",
    async () => {
      const appName = `http-ipc-proposal-${Date.now()}`;
      const created = (await invokeIpcChannelOverHttp("create-app", [
        { name: appName },
      ])) as {
        app: {
          id: number;
          resolvedPath: string;
        };
        chatId: number;
      };

      try {
        const proposal = await invokeIpcChannelOverHttp("get-proposal", [
          { chatId: created.chatId },
        ]);
        expect(proposal).toBeNull();

        await expect(
          invokeIpcChannelOverHttp("approve-proposal", [
            { chatId: created.chatId, messageId: Number.MAX_SAFE_INTEGER },
          ]),
        ).rejects.toThrow("Assistant message not found");

        await expect(
          invokeIpcChannelOverHttp("reject-proposal", [
            { chatId: created.chatId, messageId: Number.MAX_SAFE_INTEGER },
          ]),
        ).rejects.toThrow("Assistant message not found");
      } finally {
        fs.rmSync(created.app.resolvedPath, { recursive: true, force: true });
      }
    },
  );

  (hasDatabaseUrl ? it : it.skip)(
    "creates app via HTTP IPC gateway",
    async () => {
      const appName = `http-ipc-create-app-${Date.now()}`;

      const response = (await invokeIpcChannelOverHttp("create-app", [
        { name: appName },
      ])) as {
        app: {
          id: number;
          name: string;
          path: string;
          resolvedPath: string;
        };
        chatId: number;
      };

      try {
        expect(response.app.id).toBeGreaterThan(0);
        expect(response.app.name).toBe(appName);
        expect(response.app.path).toContain("http-ipc-create-app-");
        expect(fs.existsSync(response.app.resolvedPath)).toBe(true);
        expect(
          fs.existsSync(path.join(response.app.resolvedPath, ".git")),
        ).toBe(true);
        expect(response.chatId).toBeGreaterThan(0);

        const chat = (await invokeIpcChannelOverHttp("get-chat", [
          response.chatId,
        ])) as {
          initialCommitHash: string | null;
        };
        expect(chat.initialCommitHash).toMatch(/^[a-f0-9]{40}$/);
      } finally {
        fs.rmSync(response.app.resolvedPath, { recursive: true, force: true });
      }
    },
  );

  (hasDatabaseUrl ? it : it.skip)(
    "supports revert-version over HTTP IPC",
    async () => {
      const appName = `http-ipc-revert-version-${Date.now()}`;
      const created = (await invokeIpcChannelOverHttp("create-app", [
        { name: appName },
      ])) as {
        app: {
          id: number;
          resolvedPath: string;
        };
        chatId: number;
      };

      try {
        const chat = (await invokeIpcChannelOverHttp("get-chat", [
          created.chatId,
        ])) as {
          initialCommitHash: string | null;
        };
        expect(chat.initialCommitHash).toMatch(/^[a-f0-9]{40}$/);

        const revertResponse = (await invokeIpcChannelOverHttp(
          "revert-version",
          [
            {
              appId: created.app.id,
              previousVersionId: chat.initialCommitHash,
              currentChatMessageId: {
                chatId: created.chatId,
                messageId: Number.MAX_SAFE_INTEGER,
              },
            },
          ],
        )) as {
          successMessage?: string;
          warningMessage?: string;
        };

        expect(
          typeof revertResponse.successMessage === "string" ||
            typeof revertResponse.warningMessage === "string",
        ).toBe(true);
      } finally {
        fs.rmSync(created.app.resolvedPath, { recursive: true, force: true });
      }
    },
  );

  (hasDatabaseUrl ? it : it.skip)(
    "returns app not found for run-app with unknown app id",
    async () => {
      await expect(
        invokeIpcChannelOverHttp("run-app", [
          { appId: Number.MAX_SAFE_INTEGER },
        ]),
      ).rejects.toThrow("App not found");
    },
  );

  (hasDatabaseUrl ? it : it.skip)(
    "reads app file content via HTTP IPC gateway",
    async () => {
      const appName = `http-ipc-read-app-file-${Date.now()}`;
      const created = (await invokeIpcChannelOverHttp("create-app", [
        { name: appName },
      ])) as {
        app: {
          id: number;
          resolvedPath: string;
        };
      };

      try {
        const fileContent = (await invokeIpcChannelOverHttp("read-app-file", [
          { appId: created.app.id, filePath: "src/App.tsx" },
        ])) as string;

        expect(fileContent).toContain("const App");
      } finally {
        fs.rmSync(created.app.resolvedPath, { recursive: true, force: true });
      }
    },
  );

  it("throws for unsupported channels", async () => {
    await expect(
      invokeIpcChannelOverHttp("unknown-channel", []),
    ).rejects.toThrow("Unsupported channel: unknown-channel");
  });
});
