#!/usr/bin/env node
/**
 * The GUARD-BURNDOWN score table, GENERATED — never hand-typed.
 *
 * docs/GUARD-BURNDOWN.md said "do not hand-edit the numbers" and then held a
 * hand-edited table: it read 659/667 for a day after the tool measured 707/715
 * (fixed by hand in 46195b676). The owner's order (2026-09-23): every number we
 * track is current, always. So the table between the markers below is written
 * by this script from the same functions `npm run vacuity` counts with, and
 * scripts/check-generated-current.mjs regenerates it on every push and fails if
 * the committed copy differs.
 *
 *   node scripts/burndown-score.mjs            # rewrite the block in place
 *   node scripts/burndown-score.mjs --stdout   # print the block only
 */
import fs from "node:fs";
import path from "node:path";
import { REPO, guardFiles, parseDirectives, loadBaseline } from "./vacuity/lib.mjs";

export const DOC = "docs/GUARD-BURNDOWN.md";
export const BEGIN = "<!-- generated:burndown-score (node scripts/burndown-score.mjs) — do not hand-edit -->";
export const END = "<!-- /generated:burndown-score -->";

/** Scope of a guard file, in the table's row order. */
export function scopeOf(f) {
  if (f.startsWith("src/test/edge/")) return "edge";
  if (/^src\/test\/[^/]+\.test\.tsx?$/.test(f)) return "srcTest";
  if (f.startsWith("e2e/")) return "e2e";
  return "colocated";
}

const LABELS = {
  srcTest: "**`src/test/*.test.ts*`**",
  edge: "**`src/test/edge/` (money)**",
  colocated: "**colocated beside components**",
  e2e: "**Playwright `e2e/`**",
};

export function score() {
  const guards = guardFiles();
  const grandfathered = new Set(loadBaseline().unregistered ?? []);
  const rows = {};
  for (const k of Object.keys(LABELS)) rows[k] = { files: 0, proven: 0, exempt: 0, owed: 0 };
  for (const g of guards) {
    const { mutations, exemptions } = parseDirectives(g);
    const r = rows[scopeOf(g)];
    r.files++;
    if (mutations.length) r.proven++;
    else if (exemptions.length) r.exempt++;
    else r.owed++; // unregistered: grandfathered or (on a red gate) new
  }
  const total = Object.values(rows).reduce(
    (t, r) => ({ files: t.files + r.files, proven: t.proven + r.proven, exempt: t.exempt + r.exempt, owed: t.owed + r.owed }),
    { files: 0, proven: 0, exempt: 0, owed: 0 },
  );
  return { rows, total, grandfathered: grandfathered.size };
}

export function renderBlock(s = score()) {
  const cell = (r) => (r.owed === 0 && r.files > 0 ? `**${r.proven} — COMPLETE**` : `${r.proven}`);
  const L = [BEGIN, "", "| scope | files | proven able to fail | exempt, with a reason | still owed |", "|---|---|---|---|---|"];
  for (const [k, label] of Object.entries(LABELS)) {
    const r = s.rows[k];
    L.push(`| ${label} | ${r.files} | ${cell(r)} | ${r.exempt} | **${r.owed}** |`);
  }
  const pct = s.total.files ? Math.round((100 * s.total.proven) / s.total.files) : 0;
  L.push(`| **total** | **${s.total.files}** | **${s.total.proven} (${pct}%)** | **${s.total.exempt}** | **${s.total.owed}** |`);
  L.push("");
  L.push("`npm run vacuity` prints the same three numbers on every run:");
  L.push("");
  L.push("```");
  L.push(`registration: ${s.total.proven}/${s.total.files} guards register a mutation (${s.total.exempt} exempt with a reason, ${s.grandfathered} grandfathered)`);
  L.push("```");
  L.push("");
  L.push(END);
  return L.join("\n");
}

export function spliceBlock(doc, block) {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error(`${DOC}: generated block markers missing — restore them`);
  return doc.slice(0, a) + block + doc.slice(b + END.length);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const block = renderBlock();
  if (process.argv.includes("--stdout")) {
    console.log(block);
  } else {
    const p = path.join(REPO, DOC);
    fs.writeFileSync(p, spliceBlock(fs.readFileSync(p, "utf8"), block));
    const s = score();
    console.log(`${DOC}: score regenerated — ${s.total.proven}/${s.total.files} proven, ${s.total.exempt} exempt, ${s.total.owed} owed`);
  }
}
