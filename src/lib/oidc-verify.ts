import "server-only";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

export type VercelOidcClaims = JWTPayload & {
  owner?: string;
  owner_id?: string;
  project?: string;
  project_id?: string;
  environment?: string;
};

export type VerifyResult =
  | { ok: true; claims: VercelOidcClaims }
  | { ok: false; reason: string };

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJWKSIssuer: string | null = null;

function getJWKS(issuer: string) {
  if (cachedJWKS && cachedJWKSIssuer === issuer) return cachedJWKS;
  cachedJWKS = createRemoteJWKSet(
    new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`),
  );
  cachedJWKSIssuer = issuer;
  return cachedJWKS;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function verifyVercelOidc(token: string): Promise<VerifyResult> {
  const issuer = process.env.OIDC_TRUSTED_ISSUER;
  const audience = process.env.OIDC_REQUIRED_AUDIENCE;
  const allowedProjects = csv(process.env.OIDC_ALLOWED_PROJECT_IDS);
  const allowedEnvs = csv(process.env.OIDC_ALLOWED_ENVIRONMENTS);

  if (!issuer) return { ok: false, reason: "OIDC_TRUSTED_ISSUER not set" };
  if (!audience) return { ok: false, reason: "OIDC_REQUIRED_AUDIENCE not set" };
  if (allowedProjects.length === 0) {
    return { ok: false, reason: "OIDC_ALLOWED_PROJECT_IDS not set" };
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(issuer), {
      issuer,
      audience,
      algorithms: ["RS256"],
    });
    const claims = payload as VercelOidcClaims;
    if (!claims.project_id || !allowedProjects.includes(claims.project_id)) {
      return { ok: false, reason: "project_id not in allowlist" };
    }
    if (
      allowedEnvs.length > 0 &&
      (!claims.environment || !allowedEnvs.includes(claims.environment))
    ) {
      return { ok: false, reason: "environment not allowed" };
    }
    return { ok: true, claims };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification failed";
    return { ok: false, reason };
  }
}

export function readBearer(req: Request): string | null {
  const auth =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
