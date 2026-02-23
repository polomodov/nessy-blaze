import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeIpcChannelOverHttp } from "./ipc_http_gateway";

const hasDatabaseUrl = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL,
);

describe("invokeIpcChannelOverHttp", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envSnapshot };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envSnapshot };
  });

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

  it("filters legacy integration fields from user settings payloads", async () => {
    const initialSettings = (await invokeIpcChannelOverHttp(
      "get-user-settings",
      [],
    )) as {
      uiLanguage?: "ru" | "en";
    };
    const initialLanguage = initialSettings.uiLanguage ?? "ru";
    const nextLanguage: "ru" | "en" = initialLanguage === "en" ? "ru" : "en";

    try {
      const updatedSettings = (await invokeIpcChannelOverHttp(
        "set-user-settings",
        [
          {
            uiLanguage: nextLanguage,
            githubUser: { email: "legacy@example.com" },
            githubAccessToken: "legacy-github-token",
            vercelAccessToken: "legacy-vercel-token",
            supabase: { organizations: {} },
            neon: { accessToken: "legacy-neon-token" },
          } as Record<string, unknown>,
        ],
      )) as Record<string, unknown>;

      expect(updatedSettings.uiLanguage).toBe(nextLanguage);
      expect(updatedSettings).not.toHaveProperty("githubUser");
      expect(updatedSettings).not.toHaveProperty("githubAccessToken");
      expect(updatedSettings).not.toHaveProperty("vercelAccessToken");
      expect(updatedSettings).not.toHaveProperty("supabase");
      expect(updatedSettings).not.toHaveProperty("neon");

      const persistedSettings = (await invokeIpcChannelOverHttp(
        "get-user-settings",
        [],
      )) as Record<string, unknown>;
      expect(persistedSettings).not.toHaveProperty("githubUser");
      expect(persistedSettings).not.toHaveProperty("githubAccessToken");
      expect(persistedSettings).not.toHaveProperty("vercelAccessToken");
      expect(persistedSettings).not.toHaveProperty("supabase");
      expect(persistedSettings).not.toHaveProperty("neon");
    } finally {
      await invokeIpcChannelOverHttp("set-user-settings", [
        { uiLanguage: initialLanguage },
      ]);
    }
  });

  it("returns disabled OAuth2 config when not configured", async () => {
    process.env.AUTH_OAUTH2_ENABLED = "false";
    delete process.env.AUTH_OAUTH2_CLIENT_ID;
    delete process.env.AUTH_OAUTH2_AUTHORIZATION_URL;
    delete process.env.AUTH_OAUTH2_TOKEN_URL;

    const result = (await invokeIpcChannelOverHttp(
      "get-oauth2-config",
      [],
    )) as {
      enabled: boolean;
      providerName: string;
    };

    expect(result.enabled).toBe(false);
    expect(result.providerName).toBe("Google");
  });

  it("returns OAuth2 config and exchanges authorization code", async () => {
    process.env.AUTH_OAUTH2_ENABLED = "true";
    process.env.AUTH_OAUTH2_CLIENT_ID = "client-123";
    process.env.AUTH_OAUTH2_CLIENT_SECRET = "secret-123";
    process.env.AUTH_OAUTH2_AUTHORIZATION_URL =
      "https://oauth.example.com/auth";
    process.env.AUTH_OAUTH2_TOKEN_URL = "https://oauth.example.com/token";
    process.env.AUTH_OAUTH2_SCOPE = "openid profile email";
    process.env.AUTH_OAUTH2_REDIRECT_URI = "http://localhost:5173/auth";
    process.env.AUTH_OAUTH2_AUTH_EXTRA_PARAMS = "prompt=consent";
    process.env.AUTH_OAUTH2_TOKEN_EXTRA_PARAMS = "audience=api";

    const config = (await invokeIpcChannelOverHttp(
      "get-oauth2-config",
      [],
    )) as {
      enabled: boolean;
      providerName: string;
      authorizationUrl: string | null;
      clientId: string | null;
      scope: string;
      redirectUri: string | null;
      extraAuthParams: Record<string, string>;
    };
    expect(config).toEqual({
      enabled: true,
      providerName: "Google",
      authorizationUrl: "https://oauth.example.com/auth",
      clientId: "client-123",
      scope: "openid profile email",
      redirectUri: "http://localhost:5173/auth",
      extraAuthParams: {
        prompt: "consent",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "access-token",
          id_token: "id-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const exchangeResult = (await invokeIpcChannelOverHttp(
      "exchange-oauth2-code",
      [
        {
          code: "code-123",
          codeVerifier: "verifier-123",
          redirectUri: "http://localhost:5173/auth",
        },
      ],
    )) as {
      accessToken: string | null;
      idToken: string | null;
      refreshToken: string | null;
      tokenType: string | null;
      expiresIn: number | null;
      scope: string | null;
    };
    expect(exchangeResult).toEqual({
      accessToken: "access-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "openid profile email",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://oauth.example.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: expect.any(String),
    });
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=code-123");
    expect(body).toContain("code_verifier=verifier-123");
    expect(body).toContain("client_id=client-123");
    expect(body).toContain("client_secret=secret-123");
    expect(body).toContain("audience=api");
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
    "does not expose legacy integration app fields over HTTP IPC",
    async () => {
      const appName = `http-ipc-app-shape-${Date.now()}`;
      const created = (await invokeIpcChannelOverHttp("create-app", [
        { name: appName },
      ])) as {
        app: {
          id: number;
          resolvedPath: string;
        };
      };

      const legacyFields = [
        "files",
        "githubOrg",
        "githubRepo",
        "githubBranch",
        "supabaseProjectId",
        "supabaseParentProjectId",
        "supabaseProjectName",
        "supabaseOrganizationSlug",
        "neonProjectId",
        "neonDevelopmentBranchId",
        "neonPreviewBranchId",
        "vercelProjectId",
        "vercelProjectName",
        "vercelTeamSlug",
        "vercelDeploymentUrl",
      ];

      try {
        const app = (await invokeIpcChannelOverHttp("get-app", [
          created.app.id,
        ])) as Record<string, unknown>;
        for (const field of legacyFields) {
          expect(app).not.toHaveProperty(field);
        }

        const listed = (await invokeIpcChannelOverHttp("list-apps", [])) as {
          apps: Array<Record<string, unknown>>;
        };
        const listedApp = listed.apps.find(
          (item) => item.id === created.app.id,
        );
        expect(listedApp).toBeDefined();
        for (const field of legacyFields) {
          expect(listedApp).not.toHaveProperty(field);
        }
      } finally {
        fs.rmSync(created.app.resolvedPath, { recursive: true, force: true });
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
