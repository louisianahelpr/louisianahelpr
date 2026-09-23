#!/usr/bin/env node
/**
 * EVERY STATED COUNT IS GENERATED, MEASURED OR DATED.
 *
 * Owner, 2026-09-23: "ANY number we track or keep count of, anywhere, must
 * always be current." A count written into prose ("Prod holds 81 CHECK
 * constraints", "274 -> 126", "39 lanes") is a measurement frozen at the
 * moment it was typed. It is harmless while it says WHEN; undated, it reads
 * as a claim about today and rots silently — COVERAGE.md said "806
 * addressable surfaces" for three weeks after the real figure passed 1,000.
 *
 * Every count claim found (a number followed by a counted noun) is classified:
 *
 *   GENERATED  inside a file or `<!-- generated:` block that a registered
 *              generator writes (scripts/check-generated-current.mjs diffs
 *              those on every push), so it cannot be stale;
 *   RECORD     inside a dated record — a doc whose filename carries its date,
 *              or a directory of dated run outputs (RECORD_DIRS). A record
 *              claims nothing about today;
 *   DATED      a living doc or code comment whose paragraph / comment block
 *              carries a YYYY-MM-DD: a historical figure that says when it
 *              was true;
 *   UNDATED    anything else. A FAILURE — unless it is in the exact, two-way
 *              baseline (scripts/stated-counts-baseline.json) of undated
 *              counts that predate this guard. That baseline may only shrink:
 *              a new undated count fails, and so does an entry that no longer
 *              matches anything (fixed or reworded — lower the baseline).
 *
 * Fix an UNDATED count by (1) re-measuring it and adding the date, (2) moving
 * it into a generated block, or (3) deleting the number if nobody needs it.
 *
 *   node scripts/check-stated-counts.mjs            # gate
 *   node scripts/check-stated-counts.mjs --report   # inventory by class and file
 *   node scripts/check-stated-counts.mjs --show <file>   # list undated hits in a file
 *   node scripts/check-stated-counts.mjs --write-baseline  # ONLY to shrink it
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..");
export const BASELINE_PATH = "scripts/stated-counts-baseline.json";

const NOUNS = [
  "routes?", "tests?", "guards?", "files?", "workflows?", "functions?", "findings?", "lanes?", "controls?",
  "buttons?", "tables?", "migrations?", "entries", "entry", "rows?", "specs?", "surfaces?", "overlays?",
  "screens?", "pages?", "constraints?", "polic(?:y|ies)", "RPCs?", "endpoints?", "accounts?", "users?",
  "jobs?", "errors?", "exports?", "issues?", "commits?", "agents?", "types?", "templates?", "emails?",
  "notifications?", "toasts?", "dialogs?", "components?", "checks?", "items?", "rules?", "registrations?",
  "mutations?", "violations?", "call sites?", "sites?", "tabs?", "views?", "forms?", "scripts?", "crons?",
  "alerts?", "baselines?", "plugins?", "triggers?", "columns?", "indexes", "grants?", "secrets?",
  "assertions?", "screenshots?", "breaches?", "clusters?", "leaks?",
];
/**
 * A number (not part of a date, version, path, id, money, section sign or a
 * quoted example like "1 job") + optional bold + up to two words + a counted
 * noun. `**802** addressable surfaces` is a count; `§3 dimension` is not.
 */
export const COUNT_RE = new RegExp(
  String.raw`(?<![\w.$/#:@§"'-])(\d{1,3}(?:,\d{3})+|\d+)\+?\**\s+(?:[A-Za-z-]+\s+){0,2}?(?:${NOUNS.join("|")})\b`,
  "g",
);
export const DATE_RE = /(?<!\d)20\d\d-\d\d-\d\d(?!\d)/; // not \b: "COVERAGE_2026-08-31" has a word char before the year

/** Directories of dated run output: each file is a record of one run. */
export const RECORD_DIRS = [
  "docs/audit/launch-2026-09/lanes/",
  "docs/audit/launch-2026-09/inbox/",
  "docs/audit/morning/",
  "docs/audit/device-sweeps/",
  "docs/audit/gift-live/",
  "docs/audit/loading-states/",
  "docs/handoffs/",
  // Archived reports (Q165): each carries a "historical, superseded by
  // docs/OPEN.md" banner, so a count in one claims nothing about today.
  "docs/archive/",
];

const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });

/**
 * A doc that declares its own date in its first lines ("**Date:** 2026-09-03",
 * "Compiled 2026-09-02", "Generated 2026-09-12 from …") is a report of that
 * day, not a living page — it self-declares as a record.
 */
export const SELF_DATED_HEAD = /(Date:\**\s*|Compiled\s+|Generated\s+|Snapshot\s+|As of\s+)20\d\d-\d\d-\d\d/i;

export function docClass(file, generatedOutputs, text = "") {
  // A generator that owns only a <!-- generated: --> BLOCK (GUARD-BURNDOWN)
  // leaves the rest of the file living; markdownBlocks() skips the block.
  if (generatedOutputs.has(file) && !text.includes("<!-- generated:")) return "generated";
  if (DATE_RE.test(file) || RECORD_DIRS.some((d) => file.startsWith(d))) return "record";
  if (/\.md$/.test(file) && SELF_DATED_HEAD.test(text.split("\n").slice(0, 6).join("\n"))) return "record";
  return "living";
}

/** Blocks of prose (markdown paragraphs outside fences and generated blocks). */
export function markdownBlocks(text) {
  const out = [];
  let inFence = false;
  let inGenerated = false;
  let buf = [];
  let start = 1;
  const lines = text.split("\n");
  const flush = (i) => { if (buf.length) out.push({ line: start, text: buf.join("\n") }); buf = []; start = i + 2; };
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { flush(i); inFence = !inFence; start = i + 2; return; }
    if (l.includes("<!-- generated:")) { flush(i); inGenerated = true; return; }
    if (l.includes("<!-- /generated:")) { inGenerated = false; start = i + 2; return; }
    if (inFence || inGenerated) { start = i + 2; return; }
    if (!l.trim()) { flush(i); return; }
    buf.push(l);
  });
  flush(lines.length);
  return out;
}

/** Contiguous comment blocks in JS/TS source. */
export function commentBlocks(text) {
  const out = [];
  let buf = [];
  let start = 1;
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(l)) {
      if (!buf.length) start = i + 1;
      buf.push(l);
    } else if (buf.length) { out.push({ line: start, text: buf.join("\n") }); buf = []; }
  });
  if (buf.length) out.push({ line: start, text: buf.join("\n") });
  return out;
}

/** Stable key for a hit: file + the matched words + a little context, no line number. */
export function hitKey(file, block, m) {
  const ctx = block.slice(Math.max(0, m.index - 24), m.index + m[0].length).replace(/\s+/g, " ").trim();
  return `${file} :: ${ctx}`;
}

export function scanText(file, text, cls) {
  const blocks = /\.(md)$/.test(file) ? markdownBlocks(text) : commentBlocks(text);
  const hits = [];
  for (const b of blocks) {
    const dated = DATE_RE.test(b.text);
    for (const m of b.text.matchAll(COUNT_RE)) {
      const line = b.line + b.text.slice(0, m.index).split("\n").length - 1;
      hits.push({ file, line, text: m[0], key: hitKey(file, b.text, m), cls: cls === "living" ? (dated ? "dated" : "undated") : cls });
    }
  }
  return hits;
}

/** Where stated counts live: every markdown file, plus comments in tests and scripts. */
export function listSources() {
  const md = git("ls-files", "*.md").split("\n").filter(Boolean).filter((f) => !f.startsWith("node_modules/"));
  const code = git("ls-files", "--", "src/test", "scripts", "e2e", "*.test.ts", "*.test.tsx").split("\n").filter(Boolean)
    .filter((f) => /\.(mjs|cjs|js|ts|tsx)$/.test(f))
    .filter((f) => !f.startsWith("scripts/stated-counts") && f !== "scripts/check-stated-counts.mjs");
  return [...new Set([...md, ...code])].sort();
}

export async function scanAll() {
  const { GENERATED } = await import("./check-generated-current.mjs");
  const generatedOutputs = new Set(GENERATED.flatMap((g) => g.outputs));
  const hits = [];
  for (const f of listSources()) {
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    hits.push(...scanText(f, text, docClass(f, generatedOutputs, text)));
  }
  return hits;
}

export function loadBaseline() {
  const p = join(REPO, BASELINE_PATH);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { undated: [] };
}

/** Two-way: new undated counts fail, and baseline keys nothing matches fail. */
export function compare(hits, baselineKeys) {
  const undated = new Set(hits.filter((h) => h.cls === "undated").map((h) => h.key));
  const base = new Set(baselineKeys);
  const added = hits.filter((h) => h.cls === "undated" && !base.has(h.key));
  const stale = [...base].filter((k) => !undated.has(k));
  return { added, stale };
}

async function main() {
  const argv = process.argv.slice(2);
  const hits = await scanAll();
  const by = (c) => hits.filter((h) => h.cls === c).length;
  if (argv.includes("--show")) {
    const f = argv[argv.indexOf("--show") + 1];
    for (const h of hits.filter((x) => x.file === f && x.cls === "undated")) console.log(`${h.file}:${h.line}  ${h.key.split(" :: ")[1]}`);
    return;
  }
  const baseline = loadBaseline();
  if (argv.includes("--write-baseline")) {
    const keys = [...new Set(hits.filter((h) => h.cls === "undated").map((h) => h.key))].sort();
    const grew = keys.filter((k) => !baseline.undated.includes(k));
    if (baseline.undated.length && grew.length) {
      console.error(`refusing: ${grew.length} undated count(s) are NEW — date them instead of baselining them:\n` + grew.slice(0, 20).map((k) => `  ${k}`).join("\n"));
      process.exit(1);
    }
    writeFileSync(join(REPO, BASELINE_PATH), JSON.stringify({
      "//": [
        "UNDATED stated counts that predate scripts/check-stated-counts.mjs (2026-09-23).",
        "EXACT and TWO-WAY: a new undated count fails; an entry nothing matches any more fails.",
        "It may only SHRINK. Fix an entry by re-measuring and dating it, generating it, or deleting it,",
        "then run: node scripts/check-stated-counts.mjs --write-baseline",
      ],
      undated: keys,
    }, null, 2) + "\n");
    console.log(`baseline written: ${keys.length} undated count(s)`);
    return;
  }
  const files = new Set(hits.map((h) => h.file)).size;
  console.log(`stated counts: ${hits.length} found in ${files} file(s) — ${by("generated")} generated, ${by("record")} in dated records, ${by("dated")} dated, ${by("undated")} UNDATED (${baseline.undated.length} baselined).`);
  if (argv.includes("--report")) {
    const per = new Map();
    for (const h of hits.filter((x) => x.cls === "undated")) per.set(h.file, (per.get(h.file) ?? 0) + 1);
    for (const [f, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`);
    return;
  }
  if (hits.length < 1000) {
    console.error(`::error::only ${hits.length} stated counts found — the scan is broken (floor 1000), refusing to report clean`);
    process.exit(2);
  }
  const { added, stale } = compare(hits, baseline.undated);
  for (const h of added) console.error(`::error file=${h.file},line=${h.line}::UNDATED COUNT "${h.text}" — a number that says nothing about WHEN it was true. Re-measure it and add the date (YYYY-MM-DD) to its paragraph/comment, move it into a generated block, or delete it.`);
  for (const k of stale) console.error(`::error::STALE BASELINE ENTRY "${k}" — nothing matches it any more (fixed or reworded). Lower the baseline: node scripts/check-stated-counts.mjs --write-baseline`);
  if (added.length || stale.length) process.exit(1);
  console.log("OK: every stated count is generated, a dated record, dated, or in the shrinking baseline.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
