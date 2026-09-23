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
export const BASELINE_PATH = "scripts/migration-grants-baseline.json";

const allMigrationFiles = () =>
  existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => join(MIGRATIONS_DIR, f))
    : [];

/**
 * DYNAMIC GRANTS (Q263, 2026-09-23): a migration commonly locks or opens a
 * WHOLE LIST of functions with one `DO $$ … FOREACH f IN ARRAY <targets> LOOP
 * EXECUTE format('GRANT/REVOKE … ON FUNCTION %s …', f); END LOOP; END $$;`
 * block, where <targets> is a `text[]` literal of `'public.fn(args)'`
 * signature strings. `grantRe` only matches a LITERAL `GRANT`/`REVOKE …  ON
 * FUNCTION <name>` in the SQL text, so it cannot see a grant assembled at
 * runtime through `format(...)` — every function granted only this way (7 in
 * 20260919192559:1017-1048, e.g. rpc_group_member_confirm) was flagged as
 * ungranted even though its migration explicitly grants it.
 *
 * This resolves that ONE well-established idiom back to real function names,
 * per anonymous block (dollar-quote-tagged, so `$$`, `$migrate$`, `$verify$`
 * … are all found and variables are never cross-contaminated between two
 * blocks in the same file that happen to reuse a name like `f` or `t`). It
 * does NOT attempt the other dynamic shape seen in the corpus — a loop driven
 * by a live query (`FOR r IN SELECT … LOOP … format('%s', r.sig)`) — because
 * that genuinely cannot be resolved without executing SQL, and no function
 * currently flagged depends on it.
 */
function doBlocks(sql) {
  const blocks = [];
  const re = /\bDO\s+(\$[a-zA-Z_]*\$)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tag = m[1];
    const bodyStart = m.index + m[0].length;
    const end = sql.indexOf(tag, bodyStart);
    if (end < 0) continue;
    blocks.push(sql.slice(bodyStart, end));
    re.lastIndex = end + tag.length;
  }
  return blocks;
}

function functionNameFromSignature(sig) {
  // 'public.fn_name(args)' or 'public.fn_name()' or bare 'fn_name'.
  const noArgs = sig.replace(/\(.*$/s, "");
  const bare = noArgs.replace(/^public\./i, "").replace(/"/g, "").trim();
  return bare.toLowerCase();
}

/** Every function name granted/revoked via the ARRAY[]+FOREACH+format idiom in `sql`. */
export function dynamicGrantedNames(sql) {
  const names = new Set();
  for (const block of doBlocks(sql)) {
    // <var> [CONSTANT] text[] := ARRAY[ 'a', 'b', … ];
    const arrays = new Map();
    const arrayDeclRe = /\b([a-z_][a-z0-9_]*)\s+(?:CONSTANT\s+)?text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]\s*;/gi;
    let am;
    while ((am = arrayDeclRe.exec(block)) !== null) {
      const items = [...am[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
      arrays.set(am[1].toLowerCase(), items);
    }
    /*
     * FOREACH <loopVar> IN ARRAY <arrayVar> LOOP … END LOOP, scoped to each
     * loop's OWN body (non-greedy up to its nearest END LOOP). A single DO
     * block commonly runs two sibling loops that reuse the same loop-variable
     * name for different arrays (20260919192559: `FOREACH f IN ARRAY
     * client_fns` then `FOREACH f IN ARRAY trigger_fns`) — a flat
     * loopVar->arrayVar map collapses those to the LAST assignment only and
     * loses client_fns entirely, so the association has to be read from each
     * loop's own text, not a name that outlives it.
     */
    const loopRe = /\bFOREACH\s+([a-z_][a-z0-9_]*)\s+IN\s+ARRAY\s+([a-z_][a-z0-9_]*)\s+LOOP\b([\s\S]*?)\bEND\s+LOOP\b/gi;
    let lm;
    while ((lm = loopRe.exec(block)) !== null) {
      const [, loopVar, arrayVar, body] = lm;
      const items = arrays.get(arrayVar.toLowerCase());
      if (!items) continue;
      // EXECUTE format('… ON FUNCTION … %s|%I …', <loopVar>), within this loop only.
      const execRe = /\bEXECUTE\s+format\s*\(\s*'([^']*)'\s*,\s*([a-z_][a-z0-9_]*)\s*\)/gi;
      let em;
      while ((em = execRe.exec(body)) !== null) {
        const [, fmtStr, arg] = em;
        if (arg.toLowerCase() !== loopVar.toLowerCase()) continue;
        if (!/\bon\s+function\b/i.test(fmtStr) || !/\b(grant|revoke)\b/i.test(fmtStr)) continue;
        for (const sig of items) names.add(functionNameFromSignature(sig));
      }
    }
  }
  return names;
}

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
  for (const name of dynamicGrantedNames(sql)) granted.add(name);
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

// De-dupe (a name may be CREATE OR REPLACE'd more than once in the scan).
const seenKey = new Set();
const uniqueViolations = violations.filter((v) => {
  const key = `${v.name}@${v.file}`;
  if (seenKey.has(key)) return false;
  seenKey.add(key);
  return true;
});

/*
 * EXACT TWO-WAY BASELINE, `--all` ONLY (Q263, 2026-09-23).
 *
 * `--all` is an audit tool (migration-lint.yml only ever runs this on the PR's
 * CHANGED files), and every migration it can still flag after the dynamic-
 * grant fix above is a genuine open question — "is this function's PUBLIC
 * EXECUTE actually locked down live?" — that this script cannot answer by
 * reading source; it needs `pg_proc.proacl` against prod. Dumping that list
 * raw every run (as this did before) is indistinguishable from noise: it
 * never shrinks, never grows loudly, and nothing stops a NEW unverified gap
 * from hiding among the old ones. scripts/migration-grants-baseline.json
 * names each one explicitly instead, may only SHRINK (a name no longer
 * flagged must be removed from it), and a NEW flag not already in it still
 * fails — so `--all` stays informative instead of becoming wallpaper.
 *
 * Changed-files mode (the CI gate) ignores this baseline entirely: migrations
 * are never edited after landing, so a file in `changedFiles` is always a
 * brand-new migration that cannot pre-date (or appear in) the baseline.
 */
if (scanAll) {
  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { unverified: [] };
  const known = new Set(baseline.unverified ?? []);
  const keyOf = (v) => `${v.name}@${v.file}`;
  const flaggedKeys = new Set(uniqueViolations.map(keyOf));
  const newViolations = uniqueViolations.filter((v) => !known.has(keyOf(v)));
  const stale = [...known].filter((k) => !flaggedKeys.has(k));

  if (newViolations.length > 0) {
    console.error("❌ New public function(s) with no GRANT/REVOKE (static OR dynamic) and not in the baseline:\n");
    for (const v of newViolations) console.error(`   • public.${v.name}  (${v.file})`);
    console.error(`\nEither add an explicit GRANT/REVOKE, or add "${"public.<name>"}@<file>" to ${BASELINE_PATH} with a reason once live-verified.`);
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(`❌ ${BASELINE_PATH} is stale — these are no longer flagged (fixed, or no longer exist). The baseline may only SHRINK; remove them:\n`);
    for (const k of stale) console.error(`   • ${k}`);
    process.exit(1);
  }
  console.log(
    `✅ check-migration-grants --all: 0 new, 0 stale. ${known.size} known-unverified function(s) in ${BASELINE_PATH} ` +
      `(needs live pg_proc.proacl — Q263) — every one still there, none new.`,
  );
  process.exit(0);
}

if (uniqueViolations.length > 0) {
  console.error("❌ New public function(s) defined without an explicit GRANT or REVOKE:\n");
  for (const v of uniqueViolations) console.error(`   • public.${v.name}  (${v.file})`);
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
