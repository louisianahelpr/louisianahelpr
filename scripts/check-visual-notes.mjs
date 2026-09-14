#!/usr/bin/env node
/**
 * `npm run visual-notes:check` — the checklist for an owner visual-notes file
 * cannot be ticked on a claim.
 *
 * The notes file carries a "## Tracker" table:
 *
 *   | VN | Issue | Size | Fixed | Confirmed |
 *   | VN-1 | … | small | [x] 881528236 | [x] after/vn-1-1440.png |
 *
 * A row may only say Fixed when the cell names a commit that exists and is
 * reachable from HEAD. A row may only say Confirmed when it is also Fixed, the
 * named screenshot is committed beside the notes (docs/audit/<notes>/…), and
 * `reviews.jsonl` in that folder holds a verdict "ok" review of THAT
 * screenshot, recorded after the fix commit. (test-results/review-log.jsonl is
 * gitignored, so the evidence for an owner checklist is copied next to it.)
 *
 * Usage: node scripts/check-visual-notes.mjs [notes.md]   (exit 1 on any bad tick)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_NOTES = "docs/audit/visual-notes-2026-09-14.md";

/** Parse the tracker table into rows. Pure — exported for the unit test. */
export function parseTracker(md) {
  const start = md.indexOf("## Tracker");
  if (start === -1) return { rows: [], error: "no '## Tracker' section" };
  const rows = [];
  for (const line of md.slice(start).split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const m = line.match(/^\|\s*(VN-\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    const [issue, size, fixed, confirmed] = cells;
    rows.push({ id: m[1], issue, size, fixed: parseCell(fixed), confirmed: parseCell(confirmed) });
  }
  return { rows };
}

function parseCell(cell = "") {
  const m = cell.match(/^\[( |x)\]\s*(.*)$/i);
  if (!m) return { ticked: false, value: "", malformed: cell.length > 0 };
  return { ticked: m[1].toLowerCase() === "x", value: m[2].trim(), malformed: false };
}

/**
 * Check every ticked cell against its evidence. `env` injects the git and
 * filesystem lookups so the unit test can prove each rule fails.
 */
export function checkRows(rows, env) {
  const problems = [];
  for (const r of rows) {
    if (r.fixed.malformed || r.confirmed.malformed) problems.push(`${r.id}: cells must be "[ ]" or "[x] <evidence>"`);
    let fixedAt = null;
    if (r.fixed.ticked) {
      if (!r.fixed.value) problems.push(`${r.id}: Fixed is ticked with no commit`);
      else {
        fixedAt = env.commitTime(r.fixed.value);
        if (fixedAt === null) problems.push(`${r.id}: Fixed names ${r.fixed.value}, which is not a commit reachable from HEAD`);
      }
    }
    if (r.confirmed.ticked) {
      if (!r.fixed.ticked) problems.push(`${r.id}: Confirmed is ticked but Fixed is not`);
      if (!r.confirmed.value) problems.push(`${r.id}: Confirmed is ticked with no screenshot`);
      else if (!env.fileExists(r.confirmed.value)) problems.push(`${r.id}: screenshot ${r.confirmed.value} is not in the evidence folder`);
      else {
        const ok = env.reviews.find(
          (v) => v.screenshot === r.confirmed.value && v.verdict === "ok" && (fixedAt === null || Date.parse(v.reviewedAt) >= fixedAt),
        );
        if (!ok) problems.push(`${r.id}: no "ok" review of ${r.confirmed.value} recorded after the fix commit`);
      }
    }
  }
  return problems;
}

function realEnv(notesPath) {
  const evidenceDir = join(dirname(notesPath), basename(notesPath, ".md"));
  const reviewsPath = join(evidenceDir, "reviews.jsonl");
  const reviews = existsSync(reviewsPath)
    ? readFileSync(reviewsPath, "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      })
    : [];
  return {
    reviews,
    fileExists: (rel) => existsSync(join(evidenceDir, rel)),
    commitTime: (sha) => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
        return Number(execFileSync("git", ["show", "-s", "--format=%ct", sha], { encoding: "utf8" }).trim()) * 1000;
      } catch {
        return null;
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const notesPath = process.argv[2] || DEFAULT_NOTES;
  const { rows, error } = parseTracker(readFileSync(notesPath, "utf8"));
  if (error) {
    console.error(`${notesPath}: ${error}`);
    process.exit(1);
  }
  const problems = checkRows(rows, realEnv(notesPath));
  const fixed = rows.filter((r) => r.fixed.ticked).length;
  const confirmed = rows.filter((r) => r.confirmed.ticked).length;
  console.log(`${notesPath}: ${rows.length} entries · ${fixed} fixed · ${confirmed} confirmed right`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}
