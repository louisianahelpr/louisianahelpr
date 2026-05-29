#!/usr/bin/env node
/**
 * Migration grant-guard (audit H4).
 *
 * Fails when a migration defines a new public function without an explicit
 * GRANT or REVOKE anywhere in the migration history.
 *
 * Why: the Supabase advisor pass has repeatedly stripped the default PUBLIC
 * EXECUTE from functions, silently breaking RLS helpers and client RPCs —
 * the #355 / #358 / #364 / #366 grant-regression saga. A function that ships
 * without an explicit GRANT/REVOKE is relying on that vanishing default, so
 * we turn "no explicit grant" into a build-time error the moment a new
 * function lands, instead of a silent production outage weeks later.
 *
 * Trigger and event-trigger functions are exempt — they're invoked by the
 * trigger machinery, not called by a role, so they need no EXECUTE grant.
 *
 * Usage:
 *   node scripts/check-migration-grants.mjs <changed.sql> [<changed2.sql> …]
 *   node scripts/check-migration-grants.mjs --all   # audit the whole corpus
 *
 * The CHANGED files are scanned for new function definitions; the GRANT /
 * REVOKE set is gathered from the ENTIRE supabase/migrations tree, so a
 * `CREATE OR REPLACE` that merely updates an already-granted function does
 * not trip the guard.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

const allMigrationFiles = () =>
  existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => join(MIGRATIONS_DIR, f))
    : [];

const args = process.argv.slice(2);
const scanAll = args.includes("--all");
const changedFiles = scanAll ? allMigrationFiles() : args.filter((a) => a.endsWith(".sql"));

if (changedFiles.length === 0) {
  console.log("No migration files to check — nothing to do.");
  process.exit(0);
}

// GRANT/REVOKE name set, gathered from the whole corpus — a grant may live in
// an earlier migration than a later CREATE OR REPLACE. Matches both
// `GRANT EXECUTE ON FUNCTION public.fn(args) TO …` and
// `REVOKE ALL ON FUNCTION public.fn(args) FROM …`, with or without `public.`.
const grantRe = /\b(?:grant|revoke)\b[\s\S]*?\bon\s+function\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const granted = new Set();
for (const file of allMigrationFiles()) {
  const sql = readFileSync(file, "utf8");
  let m;
  while ((m = grantRe.exec(sql)) !== null) granted.add(m[1].toLowerCase());
}

// New function definitions in the changed files.
const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
const violations = [];
for (const file of changedFiles) {
  const sql = readFileSync(file, "utf8");
  let m;
  while ((m = fnRe.exec(sql)) !== null) {
    const name = m[1];
    // Look at the signature region for `RETURNS trigger`/`event_trigger` —
    // those functions are invoked by the trigger machinery, never granted.
    const sig = sql.slice(m.index, m.index + 600);
    if (/\breturns\s+(trigger|event_trigger)\b/i.test(sig)) continue;
    if (!granted.has(name.toLowerCase())) violations.push({ file, name });
  }
}

if (violations.length > 0) {
  // De-dupe (a name may be CREATE OR REPLACE'd more than once in a PR).
  const seen = new Set();
  console.error("❌ New public function(s) defined without an explicit GRANT or REVOKE:\n");
  for (const v of violations) {
    const key = `${v.name}@${v.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`   • public.${v.name}  (${v.file})`);
  }
  console.error(
    "\nA function that ships without an explicit GRANT/REVOKE relies on the\n" +
      "default PUBLIC EXECUTE, which the Supabase advisor pass keeps stripping —\n" +
      "silently breaking the app (the #355/#358/#364/#366 grant-regression saga).\n\n" +
      "Fix: add ONE of these to the migration —\n" +
      "   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;          -- callable by signed-in users\n" +
      "   REVOKE ALL ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon, authenticated;  -- locked (cron / internal)\n\n" +
      "(Trigger and event-trigger functions are exempt automatically.)",
  );
  process.exit(1);
}

console.log(
  `✅ All new public functions in the changed migration(s) carry an explicit GRANT or REVOKE (${changedFiles.length} file(s) checked).`,
);
process.exit(0);
