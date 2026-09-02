#!/usr/bin/env node
/**
 * Fail if `src/integrations/supabase/types.ts` no longer matches the live schema.
 *
 * WHY THIS EXISTS  (filed as GD-002 by lh-generated-drift, 2026-09-02)
 * Every other mirrored artifact in this repo already has a guard: the sitemap
 * has `generate-sitemap.mjs --check`, iOS metadata has ios-metadata.yml, iOS
 * icons have ios-icon-sync.yml, the migration ledger has db-drift-detect,
 * legalVersions has a parity test, and the Stripe shim is asserted by
 * typecheck-edge. `types.ts` — the one file gating type safety for the whole of
 * `src/` — had nothing.
 *
 * db-drift-detect does NOT cover it: that compares migration VERSION LISTS, so a
 * migration present in both repo and prod reports zero drift while types.ts is
 * arbitrarily stale. That is precisely the SI-012 shape — the migration shipped,
 * the regeneration did not, and a full day passed with nothing looking. When it
 * was finally regenerated it landed 25 type errors across 17 files, every one a
 * place the app would throw the first time a poster deleted their account.
 *
 * It re-opened within HOURS of being fixed: migration 20260902051631 made
 * `legal_acceptances.user_id` and `reports.reporter_id` nullable, and 8 of 17
 * legal_acceptances rows already hold a null. That is why this is a guard rather
 * than a note in a document.
 *
 * WHY IT COMPARES MEANING, NOT TEXT
 * A textual diff of the generated file is unusable as a gate. The committed file
 * carries a `graphql_public` block the documented `--schema public` command does
 * not emit, plus parenthesisation that shifts between CLI versions — about 40
 * lines of spurious diff (GD-005). A gate that cries wolf on formatting is a
 * gate someone disables. So this extracts the one thing that actually breaks
 * consumers — **every column's TYPE, and the set of RPC names** — and diffs that.\n *\n * The first version stored only a nullability boolean and therefore reported a\n * cheerful green on a `string` -> `number` change. lh-generated-drift proved it\n * by doctoring `reports.reason`. A guard that can report OK when it is not is\n * this repo's signature failure mode, so the fix is in the comparison, not the\n * message.
 *
 * USAGE
 *   node scripts/check-types-fresh.mjs                 # compare against a fresh generation
 *   node scripts/check-types-fresh.mjs --fresh <file>  # compare against an already-generated file
 *
 * Requires SUPABASE_ACCESS_TOKEN and a project ref (SUPABASE_PROJECT_REF, or
 * --project-id) unless --fresh is supplied.
 */

import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMMITTED = "src/integrations/supabase/types.ts";

/**
 * Extract `table.column -> nullable?` from a generated types file.
 *
 * Only the `Row:` block of each table matters: `Insert`/`Update` legitimately
 * mark columns optional for reasons that have nothing to do with nullability,
 * and folding them in would produce false drift on every table with a default.
 */
function nullabilityMap(source) {
  const map = new Map();
  // Tables: { <name>: { Row: { ... } ...
  const tableRe = /(\w+):\s*\{\s*Row:\s*\{([\s\S]*?)\n\s*\}/g;
  let t;
  while ((t = tableRe.exec(source)) !== null) {
    const [, table, rowBlock] = t;
    for (const line of rowBlock.split("\n")) {
      const m = line.match(/^\s*(\w+)\??:\s*(.+?);?\s*$/);
      if (!m) continue;
      const [, col, type] = m;
      // Store the normalised TYPE STRING, not a nullability boolean.
      //
      // The first version of this stored `/\bnull\b/.test(type)` and therefore
      // discarded everything except nullability — so a `text` -> `uuid` or
      // `string` -> `number` migration reported a cheerful green. lh-generated-drift
      // proved it by doctoring `reports.reason` from string to number: exit 0,
      // "✔ types.ts matches the live schema". A false green on real drift, in the
      // guard built to prevent exactly that. Nullability still falls out for free
      // by testing the two strings for `null`.
      map.set(`${table}.${col}`, type.replace(/\s+/g, " ").trim());
    }
  }
  return map;
}

/**
 * Names in the generated `Functions:` block.
 *
 * Keys only, deliberately: a signature diff would be noisy and this exists to
 * answer one question — does the app know about every RPC that exists, and does
 * it still believe in ones that are gone? A missing RPC is precisely what makes
 * someone reach for `(supabase.rpc as any)`, and those casts then outlive the
 * staleness that justified them (GD-003 — four of them, three saying verbatim
 * "drop the cast once types.ts is regenerated").
 */
function functionNames(source) {
  const names = new Set();
  // EVERY `Functions:` block, not the first. A generated file contains several
  // (one per schema), and the first is an empty `[_ in never]: never`
  // placeholder — matching only that reported "1 functions checked" against a
  // file holding 151, which is a guard that looks like it is working.
  const blockRe = /^ {4}Functions: \{$/gm;
  let b;
  while ((b = blockRe.exec(source)) !== null) {
    const rest = source.slice(b.index + b[0].length);
    const end = rest.search(/^ {4}\}$/m);
    for (const line of (end === -1 ? rest : rest.slice(0, end)).split("\n")) {
      // No end-of-line anchor: 51 of 151 functions carry content after the
      // brace, and requiring `{$` silently parsed two thirds of them away while
      // still reporting a confident count.
      const f = line.match(/^ {6}(\w+): \{/);
      if (f) names.add(f[1]);
    }
  }
  return names;
}

const PROD_REF = "fncmgoasalhdgfwzhsqa";
const STAGING_REF = "okpxtpfvwtmbuxugqsws";

function generateFresh() {
  const ref = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_ID;
  if (!ref) {
    console.error("✖ No project ref. Set SUPABASE_PROJECT_REF, or pass --fresh <file>.");
    console.error("  NOTE: supabase/.temp/project-ref points at STAGING — never rely on the linked ref here.");
    process.exit(1);
  }
  // Assert the ref rather than trusting it. A guard pointed at the wrong
  // database is confidently wrong in BOTH directions — it green-lights real
  // drift and invents drift that does not exist. This is the trap CLAUDE.md and
  // PROTOCOL §4 both name: `supabase/.temp/project-ref` points at staging, and a
  // secrets listing through the linked CLI once nearly produced a false "APNs is
  // unconfigured" conclusion for exactly this reason.
  if (ref !== PROD_REF) {
    console.error(`✖ Refusing to run against project ref "${ref}".`);
    console.error(`  Expected PROD (${PROD_REF}).`);
    if (ref === STAGING_REF) console.error("  That is the STAGING ref — types.ts mirrors PROD.");
    console.error("  A freshness check against the wrong database is worse than none:");
    console.error("  it reports green on real drift and red on none.");
    process.exit(1);
  }
  const out = join(mkdtempSync(join(tmpdir(), "lh-types-")), "fresh.ts");
  // `--schema public` matches `npm run db:types` exactly. Omitting it emits
  // extra schemas and produces a large, entirely spurious diff.
  const text = execFileSync(
    "npx",
    ["supabase", "gen", "types", "typescript", "--project-id", ref, "--schema", "public"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return { path: out, text };
}

const args = process.argv.slice(2);
const freshFlag = args.indexOf("--fresh");

if (!existsSync(COMMITTED)) {
  console.error(`✖ ${COMMITTED} not found — run from the repo root.`);
  process.exit(1);
}

let freshText;
if (freshFlag !== -1) {
  const p = args[freshFlag + 1];
  if (!p || !existsSync(p)) {
    console.error("✖ --fresh needs a path to an already-generated types file.");
    process.exit(1);
  }
  freshText = readFileSync(p, "utf8");
} else {
  freshText = generateFresh().text;
}

const committedText = readFileSync(COMMITTED, "utf8");
const committed = nullabilityMap(committedText);
const fresh = nullabilityMap(freshText);
const committedFns = functionNames(committedText);
const freshFns = functionNames(freshText);

if (fresh.size === 0) {
  // A generation that parsed to nothing would pass vacuously — the exact bug
  // this whole family of guards exists to prevent.
  console.error("✖ Parsed ZERO columns from the freshly generated types.");
  console.error("  That is a broken check, not a passing one. Refusing to report success.");
  process.exit(1);
}

const nowNullable = [];
const noLongerNullable = [];
const typeChanged = [];
const added = [];
const removed = [];

const isNullable = (type) => /\bnull\b/.test(type);

for (const [key, freshType] of fresh) {
  if (!committed.has(key)) { added.push(key); continue; }
  const wasType = committed.get(key);
  if (wasType === freshType) continue;
  const wasNull = isNullable(wasType);
  const isNull = isNullable(freshType);
  if (wasNull === isNull) {
    // Same nullability, different type — the case the first version of this
    // guard reported as GREEN.
    typeChanged.push(`${key}: ${wasType} -> ${freshType}`);
  } else {
    (isNull ? nowNullable : noLongerNullable).push(key);
  }
}
for (const key of committed.keys()) if (!fresh.has(key)) removed.push(key);

const fnAdded = [...freshFns].filter((f) => !committedFns.has(f));
const fnRemoved = [...committedFns].filter((f) => !freshFns.has(f));

const drifted =
  nowNullable.length + noLongerNullable.length + typeChanged.length +
  added.length + removed.length + fnAdded.length + fnRemoved.length;

if (drifted === 0) {
  console.log(`✔ types.ts matches the live schema (${fresh.size} columns, ${freshFns.size} functions checked)`);
  process.exit(0);
}

console.error(`\n✖ types.ts is STALE — ${drifted} difference(s) against the live schema.\n`);

if (nowNullable.length) {
  console.error("  NULLABLE IN PROD, asserted NON-NULL by the committed types:");
  console.error("  These are the dangerous ones. The compiler is asserting a guarantee the");
  console.error("  database has withdrawn, so every consumer is a latent throw.\n");
  for (const k of nowNullable) console.error(`    ${k}`);
  console.error("");
}
if (typeChanged.length) {
  console.error("  TYPE CHANGED (nullability unchanged) — the case that used to report green:");
  for (const k of typeChanged) console.error(`    ${k}`);
  console.error("");
}
if (fnAdded.length) {
  console.error(`  RPCs live in prod, absent from the types (${fnAdded.length}):`);
  console.error("  A missing RPC is what makes someone write `(supabase.rpc as any)`,");
  console.error("  and those casts outlive the staleness that justified them.\n");
  for (const k of fnAdded) console.error(`    ${k}()`);
  console.error("");
}
if (fnRemoved.length) {
  console.error(`  RPCs in the types, gone from prod (${fnRemoved.length}) — callers are already failing:`);
  for (const k of fnRemoved) console.error(`    ${k}()`);
  console.error("");
}
if (noLongerNullable.length) {
  console.error("  Non-null in prod, typed as nullable (harmless, but stale):");
  for (const k of noLongerNullable) console.error(`    ${k}`);
  console.error("");
}
if (added.length) {
  console.error(`  In prod, absent from the types (${added.length}):`);
  for (const k of added.slice(0, 20)) console.error(`    ${k}`);
  if (added.length > 20) console.error(`    … and ${added.length - 20} more`);
  console.error("");
}
if (removed.length) {
  console.error(`  In the types, gone from prod (${removed.length}) — consumers are already dead or throwing:`);
  for (const k of removed.slice(0, 20)) console.error(`    ${k}`);
  if (removed.length > 20) console.error(`    … and ${removed.length - 20} more`);
  console.error("");
}

console.error("  FIX: npm run db:types    (then fix the type errors it surfaces — that is the point)");
console.error("  Do not silence this by casting. A cast here is the SI-012 shape: 25 errors");
console.error("  across 17 files, every one a place the app throws on real data.\n");
process.exit(1);
