/**
 * Does each planned guide's generated list equal the verified plan (scripts/gift-guide-standard-1120.json)? Compares
 * count, order and section per guide and prints every mismatch: a planned pick that is not on the page, a pick on the
 * page the plan never listed, a cut that is still there, a pick out of order or in the wrong section.
 * node scripts/check-gift-guide-standard.mjs [--json]   (exit 0 always: it reports; the guard test pins what must hold)
 */
import { readFileSync } from "node:fs";
import { findPick } from "./giftGuideStandard1120.mjs";
const spec = JSON.parse(readFileSync(new URL("./gift-guide-standard-1120.json", import.meta.url), "utf8"));
const rows = [];
let exact = 0;
for (const [slug, g] of Object.entries(spec.guides)) {
  const picks = JSON.parse(readFileSync(new URL(`../src/content/giftGuidePicks/${slug}.json`, import.meta.url), "utf8")).picks;
  const planned = g.sections.flatMap((s) => s.picks.map((p) => ({ ...p, section: s.title })));
  const used = new Set();
  const issues = [];
  const at = [];
  for (const want of planned) {
    const p = findPick(picks, used, want);
    if (!p) { issues.push(`missing: "${want.name}" (${want.section})`); continue; }
    used.add(p);
    at.push(picks.indexOf(p));
    if (p.section !== want.section) issues.push(`wrong section: "${p.name}" in "${p.section}", plan "${want.section}"`);
    if (want.line && p.line !== want.line) issues.push(`reason differs: "${p.name}"`);
  }
  if (at.some((n, i) => i && n < at[i - 1])) issues.push("order differs from the plan");
  for (const c of g.cut) { const p = findPick(picks, used, c); if (p && p.name === c.name) { used.add(p); issues.push(`cut still on page: "${c.name}"`); } }
  const calls = [];
  for (const c of g.ownerCall) { const p = findPick(picks, used, c); if (p) { used.add(p); calls.push(p.name); } }
  for (const p of picks) if (!used.has(p)) issues.push(`not in plan${p.sponsor ? " (sponsor, kept)" : p.ownerPick ? " (owner pick, kept)" : ""}: "${p.name}"`);
  if (!issues.length) exact++;
  rows.push({ slug, planned: planned.length, now: picks.length, ownerCalls: calls, issues });
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
else {
  for (const r of rows) console.log(`${r.issues.length ? "MISMATCH" : "ok      "} ${r.slug}: plan ${r.planned}, page ${r.now}${r.ownerCalls.length ? ` (incl. ${r.ownerCalls.length} owner call left in place)` : ""}${r.issues.map((i) => `\n    ${i}`).join("")}`);
  console.log(`\n${exact} of ${rows.length} guides equal the plan; ${rows.reduce((n, r) => n + r.issues.length, 0)} mismatches in ${rows.length - exact} guides`);
}
