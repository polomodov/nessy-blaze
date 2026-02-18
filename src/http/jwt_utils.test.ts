import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { validateAndDecodeJwt } from "./jwt_utils";

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signHs256(header: object, payload: object, secret: string): string {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${signingInput}.${signature}`;
}

describe("validateAndDecodeJwt", () => {
  afterEach(() => {
    delete process.env.AUTH_JWT_HS256_SECRET;
    delete process.env.AUTH_JWT_STRICT_SIGNATURE;
    delete process.env.AUTH_JWT_ISSUER;
    delete process.env.AUTH_JWT_AUDIENCE;
  });

  it("validates HS256 signature and returns claims", () => {
    process.env.AUTH_JWT_HS256_SECRET = "test-secret";
    const token = signHs256(
      { alg: "HS256", typ: "JWT" },
      {
        sub: "user-1",
        email: "u@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "test-secret",
    );

    const claims = validateAndDecodeJwt(token);

    expect(claims.sub).toBe("user-1");
    expect(claims.email).toBe("u@example.com");
  });

  it("throws for expired JWT", () => {
    process.env.AUTH_JWT_HS256_SECRET = "test-secret";
    const token = signHs256(
      { alg: "HS256", typ: "JWT" },
      {
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      "test-secret",
    );

    expect(() => validateAndDecodeJwt(token)).toThrow("JWT is expired");
  });

  it("throws in strict mode when no supported verifier is configured", () => {
    process.env.AUTH_JWT_STRICT_SIGNATURE = "true";
    const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = toBase64Url(
      JSON.stringify({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const token = `${header}.${payload}.sig`;

    expect(() => validateAndDecodeJwt(token)).toThrow(
      "JWT signature verification is enabled",
    );
  });
});
