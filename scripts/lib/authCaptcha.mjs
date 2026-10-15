/**
 * Auth captcha vs the shipped web client (OPEN.md "auth-captcha-matches-client").
 *
 * Supabase Auth refuses every email-auth call without a Turnstile token while
 * `security_captcha_enabled` is on, and the web client sends one only when its
 * build compiled turnstileSiteKey() to return a key (VITE_TURNSTILE_ENABLED,
 * src/lib/turnstile.ts). The two are switched in different dashboards, so they
 * can disagree: server on + client off = nobody can sign in; server off +
 * client on = a widget on every auth form that protects nothing.
 *
 * Pure helpers; the live reads are scripts/check-auth-captcha-matches-client.mjs
 * and scripts/check-captcha-refusals.mjs. Guard: src/test/authCaptchaMatchesClient.test.ts.
 */

/** The Turnstile loader URL src/lib/turnstile.ts compiles into its chunk. */
export const TURNSTILE_LOADER = "challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * Cloudflare site keys: `0x4AAAA...` for a real widget, `1x`/`2x`/`3x` for the
 * documented test keys. Only quoted literals count.
 */
const SITE_KEY = /["'`]([0-3]x[0-9A-Za-z_-]{18,})["'`]/g;

/** Every `assets/<name>.js` a page or chunk references, deduplicated, in order. */
export function referencedChunks(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?:^|[^A-Za-z0-9_.-])((?:\/)?assets\/[A-Za-z0-9_.-]+\.js)\b/g)) {
    const p = m[1].replace(/^\//, "");
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * What the chunk holding the Turnstile loader says about tokens: the site-key
 * literals it carries. With VITE_TURNSTILE_ENABLED off, turnstileSiteKey()
 * compiles to `return null` and the key literal is dropped from the bundle
 * (measured on a vite build of src/lib/turnstile.ts both ways; see the guard).
 */
export function siteKeysIn(chunkText) {
  return [...new Set([...String(chunkText).matchAll(SITE_KEY)].map((m) => m[1]))];
}

/**
 * The verdict for one auth config and one loader chunk.
 * `config` is GET /v1/projects/{ref}/config/auth; `siteKeys` from siteKeysIn().
 * Returns { ok, detail } or throws when the config cannot be judged.
 */
export function captchaVerdict(config, siteKeys) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("auth config was not a config object");
  }
  if (typeof config.security_captcha_enabled !== "boolean") {
    throw new Error("auth config has no boolean security_captcha_enabled");
  }
  const server = config.security_captcha_enabled;
  const client = siteKeys.length > 0;
  const provider = config.security_captcha_provider ?? "(none)";
  if (server && provider !== "turnstile") {
    return { ok: false, detail: `Supabase Auth captcha is ON with provider ${provider}, but the web client only speaks Turnstile` };
  }
  if (server && !client) {
    return {
      ok: false,
      detail:
        "Supabase Auth captcha is ON but the deployed web build sends NO Turnstile token (turnstileSiteKey() compiled to null): every email sign-in, sign-up and reset is refused. Set VITE_TURNSTILE_ENABLED=true on Vercel production and redeploy, or switch captcha off",
    };
  }
  if (!server && client) {
    return {
      ok: false,
      detail: `the deployed web build ships Turnstile site key ${siteKeys.join(", ")} but Supabase Auth captcha is OFF: the widget protects nothing. Switch captcha on, or unset VITE_TURNSTILE_ENABLED and redeploy`,
    };
  }
  return {
    ok: true,
    detail: server
      ? `captcha ON (turnstile) and the web build sends tokens (site key ${siteKeys.join(", ")})`
      : "captcha OFF and the web build sends no token",
  };
}

/**
 * The refusal alert. `rows` are auth_logs captcha_failed entries
 * ({ remote_addr }). One address is a person retrying or one of our own
 * probes (every captcha_failed 2026-10-12..10-15 came from ONE address a day,
 * all this Mac's: Q1121's 60-try probe, the lead's browser tests); refusals
 * from several networks in one window are people. Never an "outage" claim:
 * it names the count and the addresses' number, nothing more.
 */
export function refusalVerdict(rows, minAddresses) {
  if (!Array.isArray(rows)) throw new Error("the logs answer had no row list");
  const addrs = new Set();
  let refusals = 0;
  for (const r of rows) {
    const a = r?.remote_addr;
    if (typeof a !== "string" || a === "") throw new Error("a captcha_failed row had no remote_addr");
    const n = Number(r.n ?? 1);
    if (!Number.isInteger(n) || n < 1) throw new Error(`a captcha_failed row had no count (${JSON.stringify(r.n)})`);
    addrs.add(a);
    refusals += n;
  }
  return { fire: addrs.size >= minAddresses, refusals, addresses: addrs.size };
}
