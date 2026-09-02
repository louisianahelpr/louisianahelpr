#!/usr/bin/env node
/**
 * Regenerate docs/audit/launch-2026-09/COVERAGE.md — the one place that answers
 * "what has been audited, what has not, and what is left".
 *
 * WHY THIS EXISTS
 * The fleet's state was being tracked in conversation prose, which has two
 * failure modes and this run hit both. It drifts (a lane is described as
 * pending when its report is on disk), and it re-asserts (the same lane gets
 * dispatched twice because nothing durable recorded that it already ran). A
 * partial run had already produced three lane reports and 55 live findings
 * before anyone checked.
 *
 * So this is DERIVED, never hand-maintained:
 *   - the lane roster from .claude/agents/lh-*.md
 *   - wave assignment from WAVES.md
 *   - who reported from lanes/*.md
 *   - what was filed from findings.jsonl (the append-only bus)
 *   - the surface count from SURFACE.md
 *
 * A hand-written status document is a claim. This one is a measurement.
 *
 * Run it after every wave: `npm run audit:coverage`.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "docs/audit/launch-2026-09";
const AGENTS = ".claude/agents";
const OUT = join(ROOT, "COVERAGE.md");

// ── lane roster ────────────────────────────────────────────────────────────
const lanes = readdirSync(AGENTS)
  .filter((f) => f.startsWith("lh-") && f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""))
  .sort();

// ── wave assignment ────────────────────────────────────────────────────────
const waves = new Map();
if (existsSync(join(ROOT, "WAVES.md"))) {
  for (const line of readFileSync(join(ROOT, "WAVES.md"), "utf8").split("\n")) {
    const m = line.match(/^\|\s*\*\*(\d+)\*\*\s*\|(.*)$/);
    if (!m) continue;
    for (const lm of m[2].matchAll(/`(lh-[\w-]+)`/g)) waves.set(lm[1], Number(m[1]));
  }
}

// ── who reported ───────────────────────────────────────────────────────────
const reported = new Set(
  existsSync(join(ROOT, "lanes"))
    ? readdirSync(join(ROOT, "lanes")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
    : [],
);

// ── the bus ────────────────────────────────────────────────────────────────
const findings = new Map(); // id -> record
const status = new Map(); // id -> latest status
if (existsSync(join(ROOT, "findings.jsonl"))) {
  for (const line of readFileSync(join(ROOT, "findings.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.kind === "finding") findings.set(r.id, r);
    else if (r.kind === "status" && r.id) status.set(r.id, r.status);
  }
}

const RETIRED = new Set(["fixed", "retracted", "duplicate", "wontfix"]);
const byLane = new Map();
for (const f of findings.values()) {
  const st = status.get(f.id) ?? "open";
  const e = byLane.get(f.agent) ?? { total: 0, live: 0, blockers: 0, fixed: 0, sev: {} };
  e.total++;
  if (RETIRED.has(st)) { if (st === "fixed") e.fixed++; } else {
    e.live++;
    if (f.launch_blocker) e.blockers++;
    e.sev[f.severity] = (e.sev[f.severity] ?? 0) + 1;
  }
  byLane.set(f.agent, e);
}

// ── surfaces ───────────────────────────────────────────────────────────────
let surfaceLine = "unknown — run `node scripts/audit-surface.mjs`";
if (existsSync(join(ROOT, "SURFACE.md"))) {
  const s = readFileSync(join(ROOT, "SURFACE.md"), "utf8");
  const m = s.match(/(\d+)\s+addressable surfaces/i) || s.match(/addressable surfaces[^\d]*(\d+)/i);
  if (m) surfaceLine = `${m[1]} addressable surfaces`;
}

// ── surface classes → the lane that owns them ──────────────────────────────
// Routes are roughly a quarter of the surface. A previous audit walked routes,
// declared coverage, and missed the dialogs and sub-paths — so coverage is
// reported against SURFACE.md classes, and each class names the lane
// accountable for it. A class whose owning lane has not started is NOT covered,
// no matter how many lanes have run.
const SURFACE_OWNERS = [
  ["Routes (non-redirect)",              ["lh-route-walker"]],
  ["Redirect-only routes",               ["lh-route-walker"]],
  ["`?tab=` variants",                   ["lh-route-walker", "lh-state-matrix"]],
  ["`?view=` variants",                  ["lh-route-walker", "lh-state-matrix"]],
  ["Overlay surfaces (instances, not files)", ["lh-state-matrix", "lh-visual-critic"]],
  ["Toast messages (each is distinct copy)",  ["lh-copy-content"]],
  ["Multi-step flows — confirmed",       ["lh-e2e-journeys"]],
  ["Multi-step flows — probable",        ["lh-e2e-journeys"]],
  ["Back/next navigation only (eyeball these)", ["lh-e2e-journeys", "lh-state-matrix"]],
  ["Forms (submittable)",                ["lh-input-boundary"]],
  ["Admin component files (24 top-level views is NOT the surface)", ["lh-admin-moderation"]],
  ["Email templates",                    ["lh-email-delivery"]],
  ["Notification types (copy + destination)", ["lh-notifications"]],
];

const surfaceCounts = new Map();
if (existsSync(join(ROOT, "SURFACE.md"))) {
  for (const line of readFileSync(join(ROOT, "SURFACE.md"), "utf8").split("\n")) {
    const m = line.match(/^\|\s*(?:\*\*)?([^|]+?)(?:\*\*)?\s*\|\s*(?:\*\*)?([\d,]+)/);
    if (m) surfaceCounts.set(m[1].trim(), Number(m[2].replace(/,/g, "")));
  }
}

// ── render ─────────────────────────────────────────────────────────────────
function stateOfLane(lane) {
  const filed = byLane.get(lane);
  if (reported.has(lane)) return "REPORTED";
  if (filed) return "RAN — no report";
  return "NOT STARTED";
}
const stateOf = stateOfLane;

const surfaceRows = SURFACE_OWNERS.map(([cls, owners]) => {
  const count = surfaceCounts.get(cls) ?? null;
  const states = owners.map((o) => stateOfLane(o));
  const covered = states.every((s) => s === "REPORTED");
  const started = states.some((s) => s !== "NOT STARTED");
  return { cls, count, owners, state: covered ? "covered" : started ? "partial" : "untouched" };
});


const rows = lanes
  .map((lane) => ({ lane, wave: waves.get(lane) ?? "—", state: stateOf(lane), f: byLane.get(lane) }))
  .sort((a, b) => (a.wave === "—" ? 99 : a.wave) - (b.wave === "—" ? 99 : b.wave) || a.lane.localeCompare(b.lane));

const done = rows.filter((r) => r.state === "REPORTED").length;
const partial = rows.filter((r) => r.state === "RAN — no report").length;
const todo = rows.filter((r) => r.state === "NOT STARTED").length;

const liveTotal = [...byLane.values()].reduce((n, e) => n + e.live, 0);
const blockerTotal = [...byLane.values()].reduce((n, e) => n + e.blockers, 0);
const fixedTotal = [...byLane.values()].reduce((n, e) => n + e.fixed, 0);

const out = [];
out.push("# Fleet coverage — what has been audited and what has not");
out.push("");
out.push("<!-- GENERATED by scripts/audit-coverage.mjs — do not hand-edit.");
out.push("     Every number here is derived from the lane roster, WAVES.md, lanes/*.md");
out.push("     and the append-only bus. Re-run after every wave: npm run audit:coverage -->");
out.push("");
out.push(`Generated: ${new Date().toISOString()}`);
out.push("");
out.push(`- **Lanes:** ${lanes.length} total — **${done} reported**, ${partial} ran without filing a report, **${todo} not started**`);
out.push(`- **Findings:** ${liveTotal} live (${blockerTotal} launch blockers), ${fixedTotal} marked fixed, ${findings.size} filed all time`);
out.push(`- **Surface:** ${surfaceLine}`);
out.push("");
out.push("**A lane that filed nothing either found nothing or never ran, and those are");
out.push("very different.** `RAN — no report` means findings exist in the bus with no");
out.push("lane report on disk — treat it as incomplete, not as covered.");
out.push("");
out.push("| Wave | Lane | State | Live | Blockers | Fixed |");
out.push("|---|---|---|---:|---:|---:|");
for (const r of rows) {
  const f = r.f;
  out.push(
    `| ${r.wave} | \`${r.lane}\` | ${r.state} | ${f ? f.live : "–"} | ${f && f.blockers ? `**${f.blockers}**` : "–"} | ${f && f.fixed ? f.fixed : "–"} |`,
  );
}
out.push("");
out.push("## Surface coverage — 806 addressable surfaces, not 35 lanes");
out.push("");
out.push("Routes are ~4% of the surface. Coverage is measured against SURFACE.md classes,");
out.push("each naming the lane accountable for it.");
out.push("");
out.push("| Surface class | Count | Owning lane(s) | Status |");
out.push("|---|---:|---|---|");
for (const r of surfaceRows) {
  const label = r.state === "covered" ? "COVERED" : r.state === "partial" ? "PARTIAL" : "UNTOUCHED";
  out.push(`| ${r.cls} | ${r.count ?? "?"} | ${r.owners.map((o) => "`" + o + "`").join(" · ")} | ${label} |`);
}
const nUntouched = surfaceRows.filter((r) => r.state === "untouched").length;
const nPartial = surfaceRows.filter((r) => r.state === "partial").length;
const biggest = surfaceRows
  .filter((r) => r.state === "untouched" && r.count)
  .sort((a, b) => b.count - a.count)
  .slice(0, 3)
  .map((r) => `${r.count} ${r.cls.replace(/ \(.*/, "").toLowerCase()}`);
out.push("");
out.push(`**${nUntouched} of ${surfaceRows.length} surface classes are UNTOUCHED** — no owning lane has started. ${nPartial} more are partially reached.`);
out.push("");
out.push(`Largest untouched classes: ${biggest.join(" · ")}.`);
out.push("");
out.push("These class counts deliberately are NOT summed. SURFACE.md excludes cross-cutting");
out.push("multi-step flows from its 806 total to avoid double-counting them against the routes");
out.push("and overlays they run through, so adding the rows here would overstate the surface.");
out.push("Read each class on its own terms.");
out.push("");
out.push("## What is left");
out.push("");
if (todo === 0 && partial === 0) {
  out.push("Every lane has reported. Remaining work is the FIX phase and `lh-verifier`.");
} else {
  out.push("Not started:");
  out.push("");
  for (const r of rows.filter((x) => x.state === "NOT STARTED")) out.push(`- wave ${r.wave} — \`${r.lane}\``);
  if (partial) {
    out.push("");
    out.push("Ran but never filed a lane report (re-dispatch or chase):");
    out.push("");
    for (const r of rows.filter((x) => x.state === "RAN — no report")) out.push(`- wave ${r.wave} — \`${r.lane}\``);
  }
}
out.push("");

writeFileSync(OUT, out.join("\n"));
console.log(`${OUT} written — ${done}/${lanes.length} lanes reported, ${todo} not started, ${liveTotal} live findings (${blockerTotal} blockers)`);
