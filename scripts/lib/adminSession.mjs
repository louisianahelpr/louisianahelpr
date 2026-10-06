/**
 * THE ONE WAY a test harness signs a test account in: a session minted with
 * the service role, never an anon password grant (docs/OPEN.md Q1314).
 *
 * WHY. Supabase Auth CAPTCHA (Cloudflare Turnstile) is about to be switched
 * on. From then on GoTrue refuses every anon `POST /auth/v1/token?grant_type=
 * password` that carries no captcha token, and a harness has no widget to get
 * one from. Every CI journey, sweeper and probe signed in exactly that way
 * (e2e/journeys/fixtures.ts, prod-lifecycle, gift-card, privacy, throwaway,
 * pressProdSafety, mint-poster-token.sh): the switch would have turned all of
 * them red at once. src/test/noAnonPasswordGrants.test.ts keeps it that way.
 *
 * HOW (read from supabase/auth's source, internal/api/api.go + mail.go +
 * verify.go, 2026-10-06; it cannot be watched live until CAPTCHA is on):
 *   1. `POST /auth/v1/admin/generate_link` with the service-role key. An admin
 *      route: requireAdminCredentials, no verifyCaptcha middleware, and no
 *      email is sent.
 *   2. `POST /auth/v1/verify {type, token_hash}`. The verify route carries the
 *      Verify rate limiter and NO verifyCaptcha middleware (only /signup,
 *      /recover, /resend, /magiclink, /otp, /token and SSO do). It answers with
 *      the same token JSON a password grant does: access_token, refresh_token,
 *      expires_at, user.
 * The link type is `recovery`, not `magiclink`, on purpose: for an address
 * with no account, generate_link `magiclink` SIGNS ONE UP (mail.go turns it
 * into a signup), so a mistyped secret would create a stray prod user;
 * `recovery` answers 404 instead. For an existing user the two are the same
 * code path (both write recovery_token; verify handles both in recoverVerify).
 *
 * TRANSPORT. Playwright callers pass `playwrightTransport(api)` so the two
 * requests go through the spec's metered APIRequestContext (e2e/requestMeter
 * counts the /verify as the sign-in); node scripts use the default `fetch`.
 *
 * Plain JS on purpose: node scripts, a bash script (via the CLI below) and the
 * Playwright TS pipeline all import it. Types: ./adminSession.d.mts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { supabaseBase } from "./apiBase.mjs";

/** The project's public (publishable) key: what a real client presents to /verify. */
export const PUBLIC_ANON_KEY = "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";
export const DEFAULT_SUPABASE_URL = "https://fncmgoasalhdgfwzhsqa.supabase.co";

/**
 * The service-role key: SUPABASE_SERVICE_ROLE_KEY from the environment (most
 * CI jobs export it after their build), else from the gitignored `.env` in
 * `cwd` (local runs, and the CI jobs that write one: privacy-journey,
 * prod-audit, press-every-control). null when neither has it.
 */
export function resolveServiceKey({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return env.SUPABASE_SERVICE_ROLE_KEY;
  let text;
  try {
    text = readFileSync(join(cwd, ".env"), "utf8");
  } catch {
    // No .env here (the normal CI case when the key is not exported): no key.
    return null;
  }
  const m = /^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m.exec(text);
  const key = m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  return key || null;
}

/** Node's fetch as a transport: `(url, {method, headers, body, timeoutMs}) -> {status, text}`. */
export async function fetchTransport(url, { method, headers, body, timeoutMs }) {
  const r = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, text: await r.text() };
}

/** A Playwright APIRequestContext as a transport (its `fetch` is what the request meter wraps). */
export function playwrightTransport(api) {
  return async (url, { method, headers, body, timeoutMs }) => {
    const r = await api.fetch(url, { method, headers, data: body, timeout: timeoutMs });
    return { status: r.status(), text: await r.text() };
  };
}

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: the answer was not JSON (${text.slice(0, 160)})`);
  }
}

/** 429, 5xx and a dropped connection are worth one more try; a 4xx about the request is not. */
const RETRYABLE = (status) => status === 0 || status === 429 || status >= 500;

/**
 * Mint a session for `email` with the service role. Returns the GoTrue token
 * JSON (access_token, refresh_token, expires_at, expires_in, token_type, user).
 * Throws with GoTrue's own status and body on any refusal, after `retries`
 * further tries of a transient failure (429, 5xx, no answer).
 */
export async function mintAdminSession({
  email,
  serviceKey,
  supabaseUrl = DEFAULT_SUPABASE_URL,
  anonKey = PUBLIC_ANON_KEY,
  transport = fetchTransport,
  timeoutMs = 45_000,
  retries = 1,
  retryDelayMs = 2_000,
}) {
  if (!email) throw new Error("mintAdminSession: no email given");
  if (!serviceKey) throw new Error(`mintAdminSession: no service-role key to mint ${email}'s session with (SUPABASE_SERVICE_ROLE_KEY)`);
  const base = supabaseBase(String(supabaseUrl).replace(/\/+$/, ""));

  const once = async () => {
    const send = async (path, headers, body, via = transport) => {
      let res;
      try {
        res = await via(`${base}${path}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body, timeoutMs });
      } catch (e) {
        res = { status: 0, text: e instanceof Error ? e.message : String(e) };
      }
      return res;
    };
    // The service-role call ALWAYS goes through node fetch, never the caller's
    // transport: a Playwright APIRequestContext is traced, and traces copy
    // request headers verbatim into trace.zip artifacts that CI uploads on
    // failure from a PUBLIC repo (lh-authz-rls review 2026-10-06). Only the
    // anon /verify call below goes through the caller's (metered) transport.
    const link = await send("/auth/v1/admin/generate_link", { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, { type: "recovery", email }, fetchTransport);
    if (link.status < 200 || link.status >= 300) return { status: link.status, error: `generate_link for ${email}: HTTP ${link.status} ${link.text.slice(0, 300)}` };
    const linkJson = parse(link.text, "generate_link");
    const tokenHash = linkJson.hashed_token ?? linkJson.properties?.hashed_token;
    if (!tokenHash) return { status: 500, error: `generate_link for ${email} answered without a hashed_token` };
    const verify = await send("/auth/v1/verify", { apikey: anonKey }, { type: "recovery", token_hash: tokenHash });
    if (verify.status < 200 || verify.status >= 300) return { status: verify.status, error: `verify for ${email}: HTTP ${verify.status} ${verify.text.slice(0, 300)}` };
    const session = parse(verify.text, "verify");
    if (!session?.access_token || !session?.refresh_token || !session?.user?.id) {
      return { status: 500, error: `verify for ${email} answered without a full session` };
    }
    if (String(session.user.email ?? "").toLowerCase() !== String(email).trim().toLowerCase()) {
      throw new Error(`minted a session for ${session.user.email}, not ${email}`);
    }
    return { session };
  };

  const errors = [];
  for (let attempt = 0; ; attempt++) {
    const r = await once();
    if (r.session) return r.session;
    errors.push(r.error);
    if (attempt >= retries || !RETRYABLE(r.status)) throw new Error(errors.join(" | after: "));
    await new Promise((res) => setTimeout(res, retryDelayMs));
  }
}

/**
 * CLI, for shell callers (scripts/e2e/mint-poster-token.sh):
 *   node scripts/lib/adminSession.mjs <email>     (key: resolveServiceKey())
 * prints the access token on stdout and nothing else; errors go to stderr.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const email = process.argv[2];
  mintAdminSession({
    email,
    serviceKey: resolveServiceKey(),
    supabaseUrl: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || PUBLIC_ANON_KEY,
  }).then(
    (s) => process.stdout.write(s.access_token),
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
