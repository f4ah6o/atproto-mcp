const MAX_ACCESS_JWT_BYTES = 64 * 1024;
const MAX_ACCESS_JWT_HEADER_BYTES = 8 * 1024;
const MAX_ACCESS_JWT_CLAIMS_BYTES = 32 * 1024;
const MAX_ACCESS_JWT_SIGNATURE_BYTES = 8 * 1024;
const MAX_ACCESS_KID_CHARS = 256;
const JWKS_TTL_MS = 300_000;

interface AccessJwk extends JsonWebKey {
  kid?: string;
}

const jwksCache = new Map<string, { keys: AccessJwk[]; expiresAt: number }>();

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  MCP_API_TOKEN?: string;
}

export interface ClientIdentity {
  subject: string;
  email: string;
}

export async function authorizeClient(
  request: Request,
  env: AccessEnv,
): Promise<ClientIdentity | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (env.MCP_API_TOKEN && authorization === `Bearer ${env.MCP_API_TOKEN}`) {
    return { subject: "mcp-api-token", email: "-" };
  }

  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) return null;

  try {
    return await verifyAccessJwt(assertion, env);
  } catch (error) {
    console.error("Cloudflare Access JWT rejected", error);
    return null;
  }
}

export async function verifyAccessJwt(
  token: string,
  env: AccessEnv,
): Promise<ClientIdentity> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUDIENCE) {
    throw new Error("Cloudflare Access JWT validation is not configured");
  }

  const parts = validateAccessJwtShape(token);
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);

  if (header.alg !== "RS256" || !accessKidAllowed(header.kid)) {
    throw new Error("unsupported JWT key");
  }

  const issuer = normalizeAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const jwks = await getJwks(issuer);
  const jwk = jwks.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("JWT signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error("invalid JWT signature");

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new Error("expired JWT");
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) {
    throw new Error("JWT not active");
  }
  if (claims.iss !== issuer) throw new Error("invalid JWT issuer");

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUDIENCE)) {
    throw new Error("invalid JWT audience");
  }

  const email = typeof claims.email === "string" ? claims.email : "";
  if (!accessEmailAllowed(env.ACCESS_ALLOWED_EMAILS, email)) {
    throw new Error("email is not allowed or ACCESS_ALLOWED_EMAILS is empty");
  }

  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("JWT subject missing");
  }

  return { subject: claims.sub, email };
}

export function validateAccessJwtShape(token: string): [string, string, string] {
  if (!token || token.length > MAX_ACCESS_JWT_BYTES) {
    throw new Error("invalid JWT size");
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid JWT");

  const limits = [
    MAX_ACCESS_JWT_HEADER_BYTES,
    MAX_ACCESS_JWT_CLAIMS_BYTES,
    MAX_ACCESS_JWT_SIGNATURE_BYTES,
  ];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (
      !part ||
      part.length > limits[index] ||
      !/^[A-Za-z0-9_-]+$/.test(part)
    ) {
      throw new Error("invalid JWT segment");
    }
  }

  return parts as [string, string, string];
}

export function accessKidAllowed(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ACCESS_KID_CHARS
  );
}

export function normalizeAccessTeamDomain(value: string): string {
  if (!value.trim()) throw new Error("ACCESS_TEAM_DOMAIN is invalid");

  const raw = value.trim();
  const candidate = raw.includes("://") ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("ACCESS_TEAM_DOMAIN is invalid");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.replaceAll("/", "") ||
    !parsed.hostname
  ) {
    throw new Error(
      "ACCESS_TEAM_DOMAIN must be an HTTPS origin without a path",
    );
  }

  return parsed.origin;
}

export function accessEmailAllowed(
  configured: string | undefined,
  email: string,
): boolean {
  const allowed = (configured ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}

async function getJwks(teamOrigin: string): Promise<AccessJwk[]> {
  const cached = jwksCache.get(teamOrigin);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${teamOrigin}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch Cloudflare Access keys: ${response.status}`);
  }

  const body = (await response.json()) as { keys?: AccessJwk[] };
  if (!Array.isArray(body.keys)) {
    throw new Error("invalid Cloudflare Access key response");
  }

  jwksCache.set(teamOrigin, {
    keys: body.keys,
    expiresAt: Date.now() + JWKS_TTL_MS,
  });
  return body.keys;
}

function decodeJwtPart(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as Record<
    string,
    unknown
  >;
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
