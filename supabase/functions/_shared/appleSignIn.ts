// Sign in with Apple, server side: keep the member's Apple refresh token at
// sign-in, and revoke it when the account is deleted (Q1791).
//
// App Store Review 5.1.1(v) requires an app offering Sign in with Apple to
// revoke the user's Apple tokens on account deletion. Supabase Auth keeps the
// Apple identity but not Apple's refresh token, so:
//   - apple-token-store exchanges the sign-in authorization code with Apple
//     (POST /auth/token) and upserts the refresh token into
//     public.apple_sign_in_tokens (service role only);
//   - accountPurge's apple_revoke step calls revokeAppleSignIn, which POSTs the
//     stored token to /auth/revoke and deletes the row, before the auth row
//     goes. Every delete path (delete-own-account, admin-delete-user,
//     cleanup-abandoned-accounts, under-13) runs purgeAccount first.
//
// SECRETS (set with `supabase secrets set`, never committed, never logged):
//   APPLE_SIGNIN_PRIVATE_KEY  the .p8 PEM of a key with "Sign in with Apple" enabled
//   APPLE_SIGNIN_KEY_ID       that key's 10-character id
//   APPLE_SIGNIN_TEAM_ID      the team id (falls back to APPLE_MAPKIT_TEAM_ID /
//                             APNS_TEAM_ID, the same team: equal secret digests 2026-10-30)
// Without them both halves answer "not_configured" and nothing is sent to Apple.

import { signEs256Jwt } from "./jwt.ts";

export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_AUDIENCE = "https://appleid.apple.com";

/**
 * The Apple clients a code may be issued to: the App ID (native iOS) and the
 * Services ID (web / Android, src/lib/socialAuth.ts initialize clientId).
 * A request naming any other client is refused, so the store cannot be pointed
 * at someone else's Apple app.
 */
const APPLE_CLIENT_IDS = ["com.Helpr", "com.Helpr.signin"] as const;
export type AppleClientId = typeof APPLE_CLIENT_IDS[number];

export function isAppleClientId(v: unknown): v is AppleClientId {
  return typeof v === "string" && (APPLE_CLIENT_IDS as readonly string[]).includes(v);
}

export interface AppleSignInKey {
  keyId: string;
  teamId: string;
  privateKey: string;
}

export function appleSignInKeyFromEnv(get: (name: string) => string | undefined): AppleSignInKey | null {
  const privateKey = get("APPLE_SIGNIN_PRIVATE_KEY")?.trim();
  const keyId = get("APPLE_SIGNIN_KEY_ID")?.trim();
  const teamId = (get("APPLE_SIGNIN_TEAM_ID") ?? get("APPLE_MAPKIT_TEAM_ID") ?? get("APNS_TEAM_ID"))?.trim();
  if (!privateKey || !keyId || !teamId) return null;
  return { keyId, teamId, privateKey };
}

/** Apple's client_secret: an ES256 JWT, sub = the client id, five minutes. */
async function appleClientSecret(key: AppleSignInKey, clientId: AppleClientId): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await signEs256Jwt({
    keyId: key.keyId,
    issuer: key.teamId,
    p8Pem: key.privateKey,
    optionalClaims: { iat: now, exp: now + 300, aud: APPLE_AUDIENCE, sub: clientId },
  });
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ExchangeResult =
  | { ok: true; refreshToken: string }
  | {
    ok: false;
    reason: "not_configured" | "apple_refused" | "no_refresh_token" | "network" | "identity_mismatch";
    status?: number;
  };

/**
 * The caller's Apple user ids: `identity_data.sub` of each provider='apple'
 * identity on the signed-in user. Measured on prod 2026-10-30: all 16 apple
 * rows in auth.identities have a non-null identity_data->>'sub', equal to
 * provider_id. An identity without one contributes nothing (refused, never
 * matched against an empty string).
 */
export function callerAppleSubs(identities: unknown): string[] {
  if (!Array.isArray(identities)) return [];
  const out: string[] = [];
  for (const i of identities as Array<{ provider?: unknown; identity_data?: { sub?: unknown } | null }>) {
    if (i?.provider !== "apple") continue;
    const sub = i.identity_data?.sub;
    if (typeof sub === "string" && sub.trim()) out.push(sub.trim());
  }
  return out;
}

/**
 * The Apple user id (`sub`) an id_token from Apple's /auth/token was issued
 * for, or null when it is missing, malformed, not from Apple, or not for this
 * client. The token comes straight from Apple's token endpoint over TLS, in
 * answer to a request we authenticated with our own client secret, so its
 * payload is read without a signature check (OpenID Connect Core 3.1.3.7(6):
 * TLS server validation may stand in for the signature on a token-endpoint
 * response). The iss and aud checks still run.
 */
export function appleIdTokenSubject(idToken: unknown, clientId: AppleClientId): string | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let claims: { iss?: unknown; aud?: unknown; sub?: unknown };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch (_e) {
    // A malformed payload counts as no identity: the caller refuses and stores nothing.
    return null;
  }
  if (claims?.iss !== APPLE_AUDIENCE) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return null;
  return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
}

/**
 * Trade a one-time authorization code for Apple's refresh token, ONLY when the
 * id_token Apple returns with it names one of `callerSubs` (the signed-in
 * member's own Apple identities). A code from a different Apple account is
 * refused with identity_mismatch and its refresh token is never returned, so
 * it can never be stored against this member (and later revoked as theirs).
 */
export async function exchangeAppleCode(
  key: AppleSignInKey | null,
  clientId: AppleClientId,
  code: string,
  callerSubs: readonly string[],
  fetchFn: FetchLike = fetch,
): Promise<ExchangeResult> {
  if (!key) return { ok: false, reason: "not_configured" };
  let res: Response;
  try {
    res = await fetchFn(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await appleClientSecret(key, clientId),
        code,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (_e) {
    // Never log the error: it can carry the form body (code, client secret).
    return { ok: false, reason: "network" };
  }
  if (!res.ok) return { ok: false, reason: "apple_refused", status: res.status };
  const body = await res.json().catch(() => null) as { refresh_token?: unknown; id_token?: unknown } | null;
  const sub = appleIdTokenSubject(body?.id_token, clientId);
  if (!sub || !callerSubs.includes(sub)) return { ok: false, reason: "identity_mismatch" };
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  if (!refreshToken) return { ok: false, reason: "no_refresh_token" };
  return { ok: true, refreshToken };
}

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export type RevokeOutcome =
  | { status: "revoked" }
  | { status: "no_token" }
  | { status: "failed"; detail: string };

/**
 * Revoke the member's stored Apple token and forget it. "no_token" when we hold
 * none (not an Apple member, or one who signed in before tokens were kept).
 * The row is deleted only after Apple answered 200, so a failed revoke can be
 * retried while the account still exists.
 */
export async function revokeAppleSignIn(
  admin: ServiceClient,
  userId: string,
  key: AppleSignInKey | null,
  fetchFn: FetchLike = fetch,
): Promise<RevokeOutcome> {
  const { data, error } = await admin
    .from("apple_sign_in_tokens")
    .select("refresh_token, client_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { status: "failed", detail: `read: ${error.message ?? "error"}` };
  if (!data?.refresh_token) return { status: "no_token" };
  if (!isAppleClientId(data.client_id)) return { status: "failed", detail: "stored client_id is not ours" };
  if (!key) return { status: "failed", detail: "not_configured: APPLE_SIGNIN_* secrets missing" };

  let res: Response;
  try {
    res = await fetchFn(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: data.client_id,
        client_secret: await appleClientSecret(key, data.client_id),
        token: data.refresh_token,
        token_type_hint: "refresh_token",
      }).toString(),
    });
  } catch (_e) {
    // Never log the error: it can carry the form body (token, client secret).
    return { status: "failed", detail: "network" };
  }
  if (!res.ok) return { status: "failed", detail: `apple answered ${res.status}` };

  const del = await admin.from("apple_sign_in_tokens").delete().eq("user_id", userId).select("user_id");
  if (del.error) return { status: "failed", detail: `revoked, but the row was not deleted: ${del.error.message ?? "error"}` };
  return { status: "revoked" };
}
