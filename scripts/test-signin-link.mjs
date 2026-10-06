#!/usr/bin/env node
/**
 * Mint a sign-in link (or a ready-to-paste session) for a SEEDED TEST ACCOUNT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `docs/archive/WALK_EVERY_SCREEN_PROMPT.md` and
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
 * `--session`: instead of handing you a link, this script mints a session
 * itself (scripts/lib/adminSession.mjs, the one captcha-free mint every
 * harness shares, Q1314) and prints the localStorage key/value pair a harness can inject
 * before first paint (Playwright: `context.addInitScript`). Use this when you
 * are driving a headless browser rather than clicking. `--json` makes that
 * output machine-readable: `{"key":…,"value":…,"session":{…}}`.
 *
 * ⚠️ A magic link is SINGLE USE, and minting a session (or another link)
 * replaces the account's outstanding one, so use a printed link at once.
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
import { acceptCurrentTerms } from "./lib/acceptCurrentTerms.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseBase } from "./lib/apiBase.mjs";
import { mintAdminSession, PUBLIC_ANON_KEY } from "./lib/adminSession.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/**
 * The seeded two-account test set (see docs/TWO_ACCOUNT_E2E_TEST_PROMPT.md).
 * Both rows are `is_seed = true` in prod. Keep the ids in sync with that doc
 * and with scripts/audit-capture.mjs.
 */
export const ACCOUNTS = {
  poster: {
    email: "helpr-audit-web-0824@mailinator.com",
    userId: "96c9899e-87a2-49e2-bbdd-268717d52aee",
    label: "Account A — Audit Weblane (poster: 7 posted jobs, every state)",
  },
  helper: {
    email: "eli.test.helper@louisianahelpr.com",
    // Re-created again: f6cc3ebb-… was gone from auth.users on 2026-10-01
    // (Q905). Live id measured 2026-10-02 (execute_sql, auth.users by email).
    // scripts/check-test-account-strikes.mjs fails nightly if any pinned id
    // here stops matching the live account for its email.
    userId: "f55112c7-612e-44a0-b6aa-443cdfbc33d6",
    label: "Account B — Audit Helper (works Account A's jobs)",
  },
  // The `poster` account above owns ZERO rows in prod `jobs` as of 2026-09-07
  // — its "7 posted jobs" are long gone, so it renders the My Posts EMPTY
  // state and is useless for measuring a populated list. This pair is the
  // 0902 E2E seed set, and the poster half is the only account in prod with
  // enough posted jobs (6) to reproduce a loaded My Posts.
  "poster-e2e": {
    email: "helpr-e2e-poster-0902@mailinator.com",
    userId: "71c56dfb-b326-4010-b960-b18dd3966e7f",
    label: "E2E poster 0902 (6 posted jobs — the populated My Posts fixture)",
  },
  "helper-e2e": {
    email: "helpr-e2e-helper-0902@mailinator.com",
    userId: "437de07d-1bd7-46c8-a451-6b46aa3bcad5",
    label: "E2E helper 0902 (counterparty to poster-e2e)",
  },
  // Created and removed by scripts/audit/prod-seed.mjs (--apply / --teardown),
  // so the auth id is not stable: generate_link returns it and takes
  // precedence over `userId` below.
  "incomplete-e2e": {
    email: "helpr-seed-incomplete-0912@mailinator.com",
    userId: null,
    label: "Seed account with an INCOMPLETE profile (no avatar, not legacy) — /complete-profile renders",
  },
  "admin-e2e": {
    email: "helpr-seed-admin-0912@louisianahelpr.com",
    userId: null,
    label: "Seed account holding the admin role (user_roles row) — sweeps /admin",
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

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) usage();

  const wantSession = args.includes("--session");
  const wantJson = args.includes("--json");
  const target = resolveTarget(args.find((a) => !a.startsWith("-")) ?? "");

  const env = readEnv();
  const supabaseUrl = supabaseBase(env.VITE_SUPABASE_URL);
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

  if (!wantSession) {
    const { actionLink, userId } = await generateLink(supabaseUrl, serviceKey, target.email);
    const resolvedUserId = userId || target.userId;
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

  // The public key, as a real client presents it to /verify and PostgREST.
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_ANON_KEY;
  // The session comes from the ONE shared mint (scripts/lib/adminSession.mjs:
  // admin generate_link + POST /verify, outside GoTrue's captcha middleware,
  // Q1314). Its /verify answer carries the full user object, the same one
  // GET /auth/v1/user returns: ProtectedRoute reads `email_confirmed_at` off
  // session.user, and an id-only stub bounced every authed route (2026-08-31).
  const session = await mintAdminSession({ email: target.email, serviceKey, supabaseUrl, anonKey });
  if (!args.includes("--keep-consent")) {
    await acceptCurrentTerms(supabaseUrl, anonKey, session.access_token, session.user.id);
  }
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

// Run only as a CLI, so check-test-account-strikes.mjs can import ACCOUNTS.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`FATAL: ${e?.message ?? e}`);
    process.exit(1);
  });
}
