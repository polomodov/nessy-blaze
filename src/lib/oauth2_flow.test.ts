import { describe, expect, it } from "vitest";
import {
  buildOAuth2AuthorizationUrl,
  createPkceCodeChallenge,
  hasOAuth2CallbackParams,
  parseJwtClaimsUnsafe,
  resolveOAuthRedirectUri,
} from "./oauth2_flow";

describe("oauth2_flow", () => {
  it("builds OAuth2 authorization URL with PKCE params", () => {
    const url = buildOAuth2AuthorizationUrl({
      config: {
        enabled: true,
        providerName: "Google",
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        clientId: "client-123",
        scope: "openid profile email",
        redirectUri: "http://localhost:5173/auth",
        extraAuthParams: {
          prompt: "consent",
        },
      },
      redirectUri: "http://localhost:5173/auth",
      state: "state-123",
      codeChallenge: "challenge-123",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth",
    );
    expect(parsed.searchParams.get("scope")).toBe("openid profile email");
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("creates expected PKCE code challenge for RFC example", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await createPkceCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("detects OAuth2 callback query params", () => {
    expect(hasOAuth2CallbackParams("?code=abc&state=1")).toBe(true);
    expect(hasOAuth2CallbackParams("?error=access_denied")).toBe(true);
    expect(hasOAuth2CallbackParams("?foo=bar")).toBe(false);
  });

  it("resolves configured OAuth redirect URI and detects origin switch", () => {
    const sameOrigin = resolveOAuthRedirectUri({
      configuredRedirectUri: "http://localhost:5173/auth",
      currentOrigin: "http://localhost:5173",
    });
    expect(sameOrigin).toEqual({
      redirectUri: "http://localhost:5173/auth",
      requiresOriginSwitch: false,
    });

    const crossOrigin = resolveOAuthRedirectUri({
      configuredRedirectUri: "http://127.0.0.1:5173/auth",
      currentOrigin: "http://localhost:5173",
    });
    expect(crossOrigin).toEqual({
      redirectUri: "http://127.0.0.1:5173/auth",
      requiresOriginSwitch: true,
    });
  });

  it("parses JWT claims without verification", () => {
    const header = btoa('{"alg":"none"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const payload = btoa('{"sub":"user-1","email":"u@example.com"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const token = `${header}.${payload}.sig`;

    expect(parseJwtClaimsUnsafe(token)).toEqual({
      sub: "user-1",
      email: "u@example.com",
    });
    expect(parseJwtClaimsUnsafe("invalid-token")).toBeNull();
  });
});
