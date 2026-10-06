/**
 * Q1323 (1): which Apple / Google client ids the app's sign-in code hands the
 * providers, DERIVED from the source that ships them, and whether prod
 * Supabase Auth accepts every one of them.
 *
 * Why: on 2026-10-05 the lead measured prod's auth config and found
 * external_apple_client_id = only the Services ID (com.Helpr.signin, so a
 * native iOS Apple id token, whose `aud` is the App ID com.Helpr, was refused),
 * external_google_client_id = only the web client (so the iOS client's token
 * was refused), skip_nonce_check false, and the web client was a Google
 * DESKTOP client (830470550612-0fg2..., Error 400 redirect_uri_mismatch). The
 * client ids live in three places (socialAuth.ts, the iOS project, Supabase's
 * dashboard) and nothing compared them.
 *
 * Sources read (never a second hand-typed copy of an id):
 *   src/lib/socialAuth.ts                 SocialLogin.initialize({ apple: { clientId },
 *                                         google: { iOSClientId, webClientId?, ... } })
 *   capacitor.config.ts                   appId (the App ID / bundle id) and the
 *                                         SocialLogin plugin's enabled providers
 *   ios/App/App.xcodeproj/project.pbxproj PRODUCT_BUNDLE_IDENTIFIER (what Xcode signs)
 *   ios/App/App/Info.plist                the reversed Google client URL scheme
 *                                         (com.googleusercontent.apps.<id>) GoogleSignIn
 *                                         needs to return to the app
 * There is no GoogleService-Info.plist or google-services.json in the repo
 * (measured 2026-10-06); if one is added, add it here.
 *
 * What prod must hold (Supabase docs, "Login with Apple" / "Login with Google",
 * native sections):
 *   external_apple_client_id   every Apple id the app uses: the Services ID
 *                              (web + the plugin's clientId) AND the App ID
 *                              (bundle), which is a native token's `aud`.
 *   external_google_client_id  the WEB client first (GoTrue's OAuth redirect
 *                              uses the first), then every native client id.
 *   external_google_skip_nonce_check  true (the iOS GoogleSignIn SDK sets a
 *                              nonce Supabase cannot see).
 * And the first Google id must never be the old Desktop client again: whether
 * a Google client is Desktop or Web is a Google Cloud console fact no Supabase
 * API returns, so the known-bad id is pinned by its prefix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../perf/bootReach.mjs";

export const SIGN_IN_SOURCES = {
  socialAuth: "src/lib/socialAuth.ts",
  capacitor: "capacitor.config.ts",
  pbxproj: "ios/App/App.xcodeproj/project.pbxproj",
  infoPlist: "ios/App/App/Info.plist",
};

/** The retired Google DESKTOP client (no redirect URIs; Error 400 redirect_uri_mismatch, 2026-10-05). */
export const OLD_DESKTOP_GOOGLE_PREFIX = "830470550612-0fg2";

const GOOGLE_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const REVERSED_GOOGLE_SCHEME = /^com\.googleusercontent\.apps\.(\d+-[a-z0-9]+)$/;

/** Every source file's text, keyed like SIGN_IN_SOURCES. Throws when one is missing. */
export function readSignInSources(root) {
  const out = {};
  for (const [key, rel] of Object.entries(SIGN_IN_SOURCES)) out[key] = readFileSync(join(root, rel), "utf8");
  return out;
}

/** XML comments blanked (offsets kept). A plist <string> cannot contain a raw `<!--`. */
const blankXmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));

/** The body of `name: { ... }` (one level, no nested braces), or null. */
function objectBody(src, name) {
  const m = new RegExp(`\\b${name}\\s*:\\s*\\{([^{}]*)\\}`).exec(src);
  return m ? m[1] : null;
}

/** `key: "value"` string properties inside an object body. */
function stringProps(body) {
  const out = [];
  for (const m of body.matchAll(/\b([A-Za-z]+)\s*:\s*(["'`])([^"'`]*)\2/g)) out.push({ key: m[1], value: m[3] });
  return out;
}

/**
 * The ids the sign-in code passes, with where each came from.
 *
 * `blank` hides TS comments before the scan. The CLI uses bootReach's
 * whole-line drop (it can never delete code on another line); the unit test
 * passes src/test/helpers/blankNonCode.ts blankComments and asserts both give
 * the same answer.
 *
 * Throws (the caller turns it into "could not run", never clean) when a source
 * no longer has the shape this reads, so a refactor cannot make it derive
 * nothing and pass.
 *
 * @returns {{
 *   appleServiceIds: {id: string, from: string}[],
 *   bundleIds: {id: string, from: string}[],
 *   googleNative: {id: string, from: string}[],
 *   googleWeb: {id: string, from: string}[],
 *   providers: Record<string, boolean>,
 *   problems: string[],
 * }}
 */
export function deriveSignInIds(src, blank = stripComments) {
  const problems = [];
  const social = blank(src.socialAuth);

  const init = /SocialLogin\.initialize\(\s*\{([\s\S]*?)\}\s*\)\s*;/.exec(social);
  if (!init) throw new Error(`${SIGN_IN_SOURCES.socialAuth}: no SocialLogin.initialize({...}) call found`);
  const appleBody = objectBody(init[1], "apple");
  const googleBody = objectBody(init[1], "google");
  if (appleBody === null || googleBody === null) {
    throw new Error(`${SIGN_IN_SOURCES.socialAuth}: SocialLogin.initialize has no apple: {...} or google: {...} block`);
  }

  const appleServiceIds = stringProps(appleBody)
    .filter((p) => p.key === "clientId")
    .map((p) => ({ id: p.value, from: `${SIGN_IN_SOURCES.socialAuth} apple.clientId` }));

  const googleNative = [];
  const googleWeb = [];
  for (const p of stringProps(googleBody)) {
    if (!/ClientId$/i.test(p.key)) continue;
    const from = `${SIGN_IN_SOURCES.socialAuth} google.${p.key}`;
    if (!GOOGLE_ID.test(p.value)) problems.push(`${from} = ${JSON.stringify(p.value)} is not a Google OAuth client id`);
    // webClientId is the web (server) client; every other *ClientId is a native one.
    (p.key === "webClientId" ? googleWeb : googleNative).push({ id: p.value, from });
  }

  const cap = blank(src.capacitor);
  const appId = /\bappId\s*:\s*(["'`])([^"'`]+)\1/.exec(cap)?.[2];
  if (!appId) throw new Error(`${SIGN_IN_SOURCES.capacitor}: no appId found`);
  const bundleIds = [{ id: appId, from: `${SIGN_IN_SOURCES.capacitor} appId` }];
  const providersBody = /SocialLogin\s*:\s*\{\s*providers\s*:\s*\{([^{}]*)\}/.exec(cap)?.[1];
  if (providersBody === undefined) throw new Error(`${SIGN_IN_SOURCES.capacitor}: no plugins.SocialLogin.providers block found`);
  const providers = {};
  for (const m of providersBody.matchAll(/\b([a-z]+)\s*:\s*(true|false)\b/g)) providers[m[1]] = m[2] === "true";

  const pbx = [...src.pbxproj.matchAll(/^\s*PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\s]+)"?\s*;/gm)].map((m) => m[1]);
  if (!pbx.length) throw new Error(`${SIGN_IN_SOURCES.pbxproj}: no PRODUCT_BUNDLE_IDENTIFIER found`);
  for (const id of new Set(pbx)) {
    if (id !== appId) problems.push(`${SIGN_IN_SOURCES.pbxproj} PRODUCT_BUNDLE_IDENTIFIER ${id} differs from ${SIGN_IN_SOURCES.capacitor} appId ${appId}`);
    if (!bundleIds.some((b) => b.id === id)) bundleIds.push({ id, from: `${SIGN_IN_SOURCES.pbxproj} PRODUCT_BUNDLE_IDENTIFIER` });
  }

  const plist = blankXmlComments(src.infoPlist);
  const schemes = [...plist.matchAll(/<string>\s*([^<\s]+)\s*<\/string>/g)].map((m) => m[1]);
  for (const s of schemes) {
    const m = REVERSED_GOOGLE_SCHEME.exec(s);
    if (!m) continue;
    const id = `${m[1]}.apps.googleusercontent.com`;
    googleNative.push({ id, from: `${SIGN_IN_SOURCES.infoPlist} URL scheme ${s}` });
    if (!googleNative.some((g) => g.id === id && g.from.startsWith(SIGN_IN_SOURCES.socialAuth))) {
      problems.push(`${SIGN_IN_SOURCES.infoPlist} URL scheme ${s} matches no google client id ${SIGN_IN_SOURCES.socialAuth} passes (GoogleSignIn returns to the app through the REVERSED client id)`);
    }
  }
  for (const g of googleNative.filter((x) => x.from.startsWith(SIGN_IN_SOURCES.socialAuth) && x.from.endsWith("iOSClientId"))) {
    const scheme = `com.googleusercontent.apps.${g.id.replace(/\.apps\.googleusercontent\.com$/, "")}`;
    if (!schemes.includes(scheme)) problems.push(`${SIGN_IN_SOURCES.infoPlist} has no URL scheme ${scheme} for ${g.from} (GoogleSignIn cannot return to the app)`);
  }

  if (!appleServiceIds.length) throw new Error(`${SIGN_IN_SOURCES.socialAuth}: apple: { clientId } not found`);
  if (!googleNative.length) throw new Error(`${SIGN_IN_SOURCES.socialAuth}: no native google client id (iOSClientId) found`);
  // Q1428 (owner, 2026-10-06): Apple + Google sign-in OFF for launch. The
  // switch decides what the live config must say (both providers disabled).
  const sw = /export\s+const\s+SOCIAL_SIGN_IN_ENABLED\s*=\s*(true|false)\s*;/.exec(social);
  if (!sw) throw new Error(`${SIGN_IN_SOURCES.socialAuth}: no SOCIAL_SIGN_IN_ENABLED switch found`);
  const socialEnabled = sw[1] === "true";
  return { appleServiceIds, bundleIds, googleNative, googleWeb, providers, problems, socialEnabled };
}

/** A comma list from the auth config, trimmed, empties dropped. null when the key is not a string. */
export function idList(value) {
  if (typeof value !== "string") return null;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Every assertion against a parsed GET /v1/projects/{ref}/config/auth.
 * @returns {{ ok: boolean, check: string, detail: string }[]}
 */
export function checkAuthConfig(config, ids) {
  const results = [];
  const add = (ok, check, detail) => results.push({ ok, check, detail });
  if (ids.socialEnabled === false) {
    // Off for launch: the providers must be OFF too, or a crafted request
    // could still sign in through an entry point the app no longer shows.
    for (const key of ["external_apple_enabled", "external_google_enabled"]) {
      add(config[key] === false, `${key} is false`, `SOCIAL_SIGN_IN_ENABLED is false (Q1428); got ${JSON.stringify(config[key])}`);
    }
    return results;
  }
  const apple = idList(config.external_apple_client_id) ?? [];
  const google = idList(config.external_google_client_id) ?? [];
  // One check per id; an id two sources carry names both.
  const uniq = (xs) => {
    const m = new Map();
    for (const x of xs) m.set(x.id, m.has(x.id) ? { id: x.id, from: `${m.get(x.id).from} + ${x.from}` } : x);
    return [...m.values()];
  };

  for (const [key, provider] of [["external_apple_enabled", "apple"], ["external_google_enabled", "google"]]) {
    if (ids.providers[provider] !== true) continue;
    add(config[key] === true, `${key} is true`, `capacitor.config.ts enables the ${provider} SocialLogin provider; got ${JSON.stringify(config[key])}`);
  }

  for (const b of uniq(ids.bundleIds)) {
    add(apple.includes(b.id), `external_apple_client_id includes the App ID (bundle) ${b.id}`, `a native iOS Apple id token's aud is the bundle id (${b.from}); list = ${JSON.stringify(apple)}`);
  }
  for (const a of uniq(ids.appleServiceIds)) {
    add(apple.includes(a.id), `external_apple_client_id includes ${a.id}`, `${a.from}; list = ${JSON.stringify(apple)}`);
  }

  const first = google[0];
  const nativeIds = new Set(ids.googleNative.map((g) => g.id));
  const webOk =
    typeof first === "string" &&
    GOOGLE_ID.test(first) &&
    !nativeIds.has(first) &&
    (ids.googleWeb.length === 0 || ids.googleWeb.some((w) => w.id === first));
  add(
    webOk,
    "external_google_client_id lists the WEB client first",
    `first = ${JSON.stringify(first ?? null)}; must be a Google client id, none of the native ids (${[...nativeIds].join(", ")})${ids.googleWeb.length ? `, and equal to ${ids.googleWeb.map((w) => w.from).join(", ")}` : ""}`,
  );
  add(
    typeof first === "string" && !first.startsWith(OLD_DESKTOP_GOOGLE_PREFIX),
    `the first Google client id is not the old Desktop client ${OLD_DESKTOP_GOOGLE_PREFIX}...`,
    `first = ${JSON.stringify(first ?? null)} (a Desktop client has no redirect URIs: Error 400 redirect_uri_mismatch)`,
  );
  for (const g of uniq(ids.googleNative)) {
    const at = google.indexOf(g.id);
    add(at >= 1, `external_google_client_id lists native client ${g.id} after the web client`, `${g.from}; position ${at} in ${JSON.stringify(google)}`);
  }
  for (const w of uniq(ids.googleWeb)) {
    add(google.includes(w.id), `external_google_client_id includes ${w.id}`, `${w.from}; list = ${JSON.stringify(google)}`);
  }
  add(
    config.external_google_skip_nonce_check === true,
    "external_google_skip_nonce_check is true",
    `native iOS Google sign-in sends a nonce Supabase cannot verify; got ${JSON.stringify(config.external_google_skip_nonce_check)}`,
  );
  for (const p of ids.problems) add(false, "the native sign-in sources agree", p);
  return results;
}
