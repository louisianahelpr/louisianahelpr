#!/usr/bin/env node
/**
 * Mint a magic-link sign-in for a SEEDED TEST ACCOUNT.
 *
 * WHY THIS EXISTS. Audits of this app repeatedly reported it clean while real
 * breakage sat in production, and the root cause was always the same: a session
 * that cannot log in cannot operate the app, so it silently substituted reading
 * the code and reported that as verification. Every bug the owner found by hand
 * — the splash that never rendered, pull-to-refresh frozen after one frame,
 * Browse omitting open jobs — was invisible to reading and obvious to anyone
 * actually using the app.
 *
 * Nobody may type a password (a hard rule, and not one worth working around).
 * So the fix is to make a password unnecessary: the service-role key mints a
 * one-time sign-in link through Supabase's admin API, exactly as the product's
 * own magic-link flow does.
 *
 * SAFETY. Refuses any address that is not one of the seeded test accounts
 * below. The service-role key bypasses RLS entirely, so this must never become
 * a way to log in as a real person. Add to ALLOWED only accounts whose rows
 * carry `is_seed = true`.
 *
 * Usage:
 *   node scripts/test-signin-link.mjs poster    # Audit Weblane
 *   node scripts/test-signin-link.mjs helper    # Audit Helper
 *   node scripts/test-signin-link.mjs <one of the allowed emails>
 *
 * Open the printed URL in the simulator or browser and the session is live.
 * Sessions persist, so this is typically needed once per device, not per run.
 */
import { readFileSync } from "node:fs";

/** Seeded test accounts only — see the SAFETY note above. */
const ALLOWED = {
  poster: "helpr-audit-web-0824@mailinator.com",
  helper: "eli.test.helper@louisianahelpr.com",
};

function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

const arg = (process.argv[2] || "").trim();
if (!arg) {
  console.error("Usage: node scripts/test-signin-link.mjs <poster|helper|email>");
  process.exit(1);
}

const email = ALLOWED[arg] ?? arg;
if (!Object.values(ALLOWED).includes(email)) {
  console.error(`Refused: "${email}" is not a seeded test account.`);
  console.error("Allowed:", Object.entries(ALLOWED).map(([k, v]) => `${k} = ${v}`).join("\n         "));
  process.exit(1);
}

const env = loadEnv();
const base = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not in .env.");
  console.error("Supabase dashboard -> Project Settings -> API -> service_role (secret).");
  process.exit(1);
}

const res = await fetch(`${base}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});

const body = await res.json();
if (!res.ok || !body.action_link) {
  console.error(`Failed (HTTP ${res.status}):`, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}

console.log(`Sign-in link for ${email}:\n`);
console.log(body.action_link);
console.log("\nOpen it in the simulator or browser. The session persists afterwards.");
