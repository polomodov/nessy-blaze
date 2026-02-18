import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnvVar } from "../ipc/utils/read_env";

export interface JwtClaims {
  sub: string;
  email?: string;
  name?: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  [key: string]: unknown;
}

interface JwtHeader {
  alg?: string;
  typ?: string;
}

function readConfig(name: string): string | undefined {
  return process.env[name] ?? getEnvVar(name);
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded =
    padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseJwt(token: string): {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: string;
  signature: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(decodeBase64Url(parts[0])) as JwtHeader;
    claims = JSON.parse(decodeBase64Url(parts[1])) as JwtClaims;
  } catch {
    throw new Error("Invalid JWT payload");
  }

  if (!claims.sub || typeof claims.sub !== "string") {
    throw new Error('Invalid JWT: "sub" is required');
  }

  return {
    header,
    claims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
  };
}

function verifyHs256Signature(params: {
  signingInput: string;
  signature: string;
  secret: string;
}) {
  const expected = encodeBase64Url(
    createHmac("sha256", params.secret).update(params.signingInput).digest(),
  );
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(params.signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error("Invalid JWT signature");
  }
}

function validateStandardClaims(claims: JwtClaims) {
  if (typeof claims.exp === "number") {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (claims.exp < nowSeconds) {
      throw new Error("JWT is expired");
    }
  }

  const expectedIssuer = readConfig("AUTH_JWT_ISSUER");
  if (expectedIssuer && claims.iss !== expectedIssuer) {
    throw new Error("Invalid JWT issuer");
  }

  const expectedAudience = readConfig("AUTH_JWT_AUDIENCE");
  if (expectedAudience) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(expectedAudience)) {
      throw new Error("Invalid JWT audience");
    }
  }
}

export function validateAndDecodeJwt(token: string): JwtClaims {
  const parsed = parseJwt(token);
  const hsSecret = readConfig("AUTH_JWT_HS256_SECRET");
  const strictSignatureMode =
    (readConfig("AUTH_JWT_STRICT_SIGNATURE") ?? "false").toLowerCase() ===
    "true";

  if (parsed.header.alg === "HS256" && hsSecret) {
    verifyHs256Signature({
      signingInput: parsed.signingInput,
      signature: parsed.signature,
      secret: hsSecret,
    });
  } else if (strictSignatureMode) {
    throw new Error(
      "JWT signature verification is enabled but no supported verifier is configured",
    );
  }

  validateStandardClaims(parsed.claims);
  return parsed.claims;
}
