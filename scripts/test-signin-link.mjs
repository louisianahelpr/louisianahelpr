#!/usr/bin/env node
/**
 * Mint a sign-in link (or a ready-to-paste session) for a SEEDED TEST ACCOUNT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `docs/audit/WALK_EVERY_SCREEN_PROMPT.md` and
 * `docs/TWO_ACCOUNT_E2E_TEST_PROMPT.md` both tell a fresh session to run
 * `node scripts/test-signin-link.mjs poster|helper` as step one. The file did
 * not exist, so every session following those prompts stalled at sign-in — and
 * a stalled sign-in is exactly how audits end up reading source and reporting
 * it as testing. This is that missing script.
 *
 * It also settles the "Claude cannot type passwords" constraint: no password
 * is ever typed, by anyone. Supabase's admin `generate_link` endpoint mints a
 * one-time magic link with the service-role key, so a session is obtained
 * programmatically. See `.claude/skills/lh-audit/SKILL.md` §5 for the standing
 * authorization to self-provision test sessions.
 *
 * USAGE
 * -----
 *   node scripts/test-signin-link.mjs poster          # Account A — Audit Weblane
 *   node scripts/test-signin-link.mjs helper          # Account B — Audit Helper
 *   node scripts/test-signin-link.mjs helper --session
 *   node scripts/test-signin-link.mjs helper --session --json
 *
 * Default: prints a magic-link URL. Open it in Chrome or the iOS Simulator and
 * the session persists in that browser's storage.
 *
 * `--session`: instead of handing you a link, this script follows the link
 * itself and prints the localStorage key/value pair a harness can inject
 * before first paint (Playwright: `context.addInitScript`). Use this when you
 * are driving a headless browser rather than clicking. `--json` makes that
 * output machine-readable: `{"key":…,"value":…,"session":{…}}`.
 *
 * ⚠️ A magic link is SINGLE USE. `--session` consumes the link it mints, so
 * the two modes each mint their own link — never reuse one across both.
 *
 * REQUIREMENTS
 * ------------
 * `.env` at the repo root with `VITE_SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY`. `.env` is gitignored; copy it from the main
 * checkout into any worktree you work in.
 *
 * SAFETY
 * ------
 * The email allowlist below is the whole safety model: any address that is not
 * a known seeded test account is refused before a single network call is made.
 * This script can never mint a session for a real user. Do not "temporarily"
 * widen the allowlist — add the account to the seed set instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * The seeded two-account test set (see docs/TWO_ACCOUNT_E2E_TEST_PROMPT.md).
 * Both rows are `is_seed = true` in prod. Keep the ids in sync with that doc
 * and with scripts/audit-capture.mjs.
 */
const ACCOUNTS = {
  poster: {
    email: "helpr-audit-web-0824@mailinator.com",
    userId: "e977a30f-7065-4e75-8498-dba435ac2044",
    label: "Account A — Audit Weblane (poster: 7 posted jobs, every state)",
  },
  helper: {
    email: "eli.test.helper@louisianahelpr.com",
    userId: "6bdc1f67-ae1f-46a0-8edf-4035629a6147",
    label: "Account B — Audit Helper (works Account A's jobs)",
  },
};

/** Every address this script will ever mint for. Nothing else is permitted. */
const ALLOWED_EMAILS = new Set(Object.values(ACCOUNTS).map((a) => a.email));

function usage(msg) {
  if (msg) console.error(`\nERROR: ${msg}\n`);
  console.error(`Usage: node scripts/test-signin-link.mjs <poster|helper|<seeded-test-email>> [--session] [--json]

  poster    ${ACCOUNTS.poster.email}
  helper    ${ACCOUNTS.helper.email}

  --session  follow the link and print the localStorage session blob instead
             of the URL (consumes the link; for headless harnesses)
  --json     with --session, emit JSON only

Any address outside the seeded test set is refused.`);
  process.exit(msg ? 1 : 0);
}

/** Minimal .env reader — same parser scripts/audit-capture.mjs uses. */
function readEnv() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(
      `ERROR: no .env at ${envPath}.\n` +
        `It is gitignored — copy it from the main checkout:\n` +
        `  cp /Users/lexilombas/louisianahelpr/.env "${repoRoot}/.env"`,
    );
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function resolveTarget(arg) {
  if (ACCOUNTS[arg]) return ACCOUNTS[arg];
  if (arg.includes("@")) {
    const email = arg.toLowerCase();
    if (!ALLOWED_EMAILS.has(email)) {
      // The refusal that makes this script safe to hand to any session.
      console.error(
        `\nREFUSED: "${arg}" is not a seeded test account.\n\n` +
          `This script only ever mints sessions for:\n` +
          [...ALLOWED_EMAILS].map((e) => `  - ${e}`).join("\n") +
          `\n\nMinting a link for a real user's address would hand over their ` +
          `account. If you need a new persona, seed it (is_seed = true) and ` +
          `add it to ACCOUNTS in this file.\n`,
      );
      process.exit(2);
    }
    const found = Object.values(ACCOUNTS).find((a) => a.email === email);
    return found;
  }
  usage(`unknown target "${arg}" — expected "poster", "helper", or a seeded test email.`);
}

async function generateLink(supabaseUrl, serviceKey, email) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!res.ok) {
    throw new Error(`generate_link failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const actionLink = json.action_link || json.properties?.action_link;
  if (!actionLink) throw new Error("generate_link response had no action_link");
  return { actionLink, userId: json.user?.id || json.id || null };
}

/**
 * Follow the one-time link and pull the tokens out of the Location hash.
 * Supabase redirects to `<site>/#access_token=…&refresh_token=…`; the tokens
 * are in the FRAGMENT, so they never appear in a query string or a server log.
 */
async function exchangeForSession(actionLink, userId, supabaseUrl, anonKey) {
  const res = await fetch(actionLink, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`no Location header from action_link (status ${res.status})`);
  const hashIdx = location.indexOf("#");
  if (hashIdx === -1) throw new Error(`Location had no hash fragment: ${location}`);
  const hash = new URLSearchParams(location.slice(hashIdx + 1));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (!access_token || !refresh_token) {
    throw new Error(`missing tokens in hash fragment: ${location}`);
  }
  // FETCH THE REAL USER OBJECT. This used to be `user: { id: userId }` — a stub
  // with nothing but an id. Three separate verification harnesses were silently
  // broken by it on 2026-08-31 and each rediscovered the cause independently:
  // `ProtectedRoute` reads `email_confirmed_at` off `session.user`, an absent
  // field is falsy, so EVERY authed route bounced to /account-pending and then
  // /dashboard. The harness looked signed in, and every deep link it tried
  // landed somewhere else — which reads as an app bug, not a harness bug.
  //
  // `GET /auth/v1/user` with the freshly-minted access token returns exactly
  // the object supabase-js would have cached, so the blob is now faithful by
  // construction rather than by us guessing which fields matter next.
  let user = { id: userId };
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${access_token}` },
    });
    if (userRes.ok) {
      const full = await userRes.json();
      if (full?.id) user = full;
      else console.error("[warn] /auth/v1/user returned no id; falling back to the id-only stub");
    } else {
      console.error(`[warn] /auth/v1/user returned ${userRes.status}; falling back to the id-only stub`);
    }
  } catch (err) {
    // Never fatal: a usable-but-thin session still beats no session, and the
    // warning above tells you why a route bounce is the harness, not the app.
    console.error(`[warn] could not fetch the full user object: ${err?.message ?? err}`);
  }

  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Number(hash.get("expires_at")) || Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) usage();

  const wantSession = args.includes("--session");
  const wantJson = args.includes("--json");
  const target = resolveTarget(args.find((a) => !a.startsWith("-")) ?? "");

  const env = readEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "ERROR: .env is missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Both are required — generate_link is an admin endpoint.",
    );
    process.exit(1);
  }

  const projectRef = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "fncmgoasalhdgfwzhsqa";
  const storageKey = `sb-${projectRef}-auth-token`;

  const { actionLink, userId } = await generateLink(supabaseUrl, serviceKey, target.email);
  const resolvedUserId = userId || target.userId;

  if (!wantSession) {
    if (wantJson) {
      console.log(JSON.stringify({ email: target.email, userId: resolvedUserId, actionLink }, null, 2));
      return;
    }
    console.log(`\n${target.label}`);
    console.log(`email:   ${target.email}`);
    console.log(`user_id: ${resolvedUserId}`);
    console.log(`\nMagic link (SINGLE USE — opening it signs that browser in):\n`);
    console.log(actionLink);
    console.log(
      `\nOpen it in Chrome, or in the iOS Simulator, and the session persists ` +
        `in that browser's storage.\nFor a headless harness, re-run with --session ` +
        `to get the localStorage blob instead.\n` +
        `\nREMINDER: dismiss the onboarding tour before auditing anything — it opens ` +
        `on every fresh\nbrowser context and blurs/intercepts the page. Seed ` +
        `localStorage["helpr_onboarding"] =\n  {"completed":true,"currentStep":0,"completedSteps":[]}\n`,
    );
    return;
  }

  // anon key preferred for /auth/v1/user — it is the key a real client would
  // present; the service key works too but would mask an anon-key misconfig.
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || serviceKey;
  const session = await exchangeForSession(actionLink, resolvedUserId, supabaseUrl, anonKey);
  const value = JSON.stringify(session);

  if (wantJson) {
    console.log(JSON.stringify({ key: storageKey, value, session }, null, 2));
    return;
  }

  console.log(`\n${target.label}`);
  console.log(`\nThe magic link has been CONSUMED to produce this session.\n`);
  console.log(`localStorage key:\n  ${storageKey}\n`);
  console.log(`localStorage value:\n  ${value}\n`);
  console.log(
    `Playwright:\n` +
      `  await context.addInitScript(({ key, val }) => {\n` +
      `    try { window.localStorage.setItem(key, val); } catch {}\n` +
      `    // Same trip: kill the onboarding tour, or it blurs every screen you audit.\n` +
      `    try { window.localStorage.setItem("helpr_onboarding",\n` +
      `      JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] })); } catch {}\n` +
      `  }, { key: ${JSON.stringify(storageKey)}, val: <the value above> });\n`,
  );
}

main().catch((e) => {
  console.error(`FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
