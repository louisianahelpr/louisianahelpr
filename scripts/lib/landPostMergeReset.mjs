#!/usr/bin/env node
/**
 * A landing never carries the whole-tree totals (owner, 2026-10-12: "fix the
 * bottleneck before" ~300 items are worked by six lanes at once).
 *
 * The postMerge generators in scripts/check-generated-current.mjs (vacuity
 * report, burn-down, queue score, scoreboard, audit surface/coverage/rollup)
 * count the WHOLE tree, so any two branches that regenerate them touch the same
 * lines. Since 2026-10-04 land.sh refreshed with --skip-post-merge, but the
 * branches' own commits still carried them: `npm run inventories:refresh` (the
 * brief's pre-push step) regenerated them, and so did hand refresh commits. On
 * the 60 land PRs merged 2026-10-09..12, docs/SCOREBOARD.md was in 26 PR diffs,
 * GUARD-BURNDOWN.md and vacuity-report.json in 19 each; 27 of the 60 were
 * force-pushed again after going DIRTY, and those 27 took 2033 of the 2387
 * PR-open minutes (median 39 min against 7 for the rest).
 *
 * So after the rebase, land.sh puts every postMerge output back to origin/main's
 * bytes: whole files as they are on main, and in docs/OPEN.md only the generated
 * blocks those generators own (everything-open, queue-count), keeping the
 * branch's items. The PR's diff then never touches those lines and cannot
 * conflict on them; staleness-watch.yml regenerates main after the merge
 * (bot/refresh/inventories) and main's own check stays strict.
 *
 * Refuses (exit 1) when the branch put hand-written lines inside one of those
 * OPEN.md blocks: the reset would delete them (generatedBlocksKeepHandWrittenText).
 *
 *   node scripts/lib/landPostMergeReset.mjs [--base origin/main]
 *
 * Guard: src/test/landPostMergeReset.test.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { GENERATED } from "../check-generated-current.mjs";
import { foreignLines } from "./openQueue.mjs";
import { COUNT_LINE_SHAPE, START as QC_START, END as QC_END } from "../queue-count.mjs";
import { EO_START, EO_END, OPEN_BLOCK_SHAPES } from "../scoreboard.mjs";

export const OPEN = "docs/OPEN.md";

/** The OPEN.md blocks owned by a postMerge generator, with the lines each may hold. */
export const OPEN_BLOCKS = [
  { id: "scoreboard", start: EO_START, end: EO_END, shapes: OPEN_BLOCK_SHAPES },
  { id: "queue-count", start: QC_START, end: QC_END, shapes: [COUNT_LINE_SHAPE] },
];

/** Every output a postMerge generator writes (OPEN.md handled by block). */
export function postMergeOutputs(generated = GENERATED) {
  return [...new Set(generated.filter((g) => g.postMerge).flatMap((g) => g.outputs))];
}

function between(text, start, end) {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i + 1);
  return i >= 0 && j > i ? { i, j: j + end.length, inner: text.slice(i + start.length, j) } : null;
}

/**
 * Pure. `branch` with each postMerge block replaced by `main`'s copy of it.
 * Returns { text, foreign: [{id, lines}] }; a block missing on either side is
 * left as the branch has it.
 */
export function spliceBlocks(branch, main, blocks = OPEN_BLOCKS) {
  let text = branch;
  const foreign = [];
  for (const b of blocks) {
    const ours = between(text, b.start, b.end);
    const theirs = between(main, b.start, b.end);
    if (!ours || !theirs) continue;
    const lines = foreignLines(ours.inner, b.shapes);
    if (lines.length) foreign.push({ id: b.id, lines });
    text = text.slice(0, ours.i) + main.slice(theirs.i, theirs.j) + text.slice(ours.j);
  }
  return { text, foreign };
}

function showAt(ref, path, cwd) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function reset({ cwd, base = "origin/main", outputs = postMergeOutputs() }) {
  const moved = [];
  for (const o of outputs) {
    const p = join(cwd, o);
    const here = existsSync(p) ? readFileSync(p, "utf8") : null;
    const main = showAt(base, o, cwd);
    if (o === OPEN) {
      if (here === null || main === null) continue;
      const { text, foreign } = spliceBlocks(here, main);
      if (foreign.length) {
        for (const f of foreign) console.error(`landPostMergeReset: hand-written line(s) inside the generated ${f.id} block of ${OPEN}; move them outside the markers:\n${f.lines.map((l) => `  ${l.slice(0, 160)}`).join("\n")}`);
        return { ok: false, moved };
      }
      if (text !== here) { writeFileSync(p, text); moved.push(`${o} (generated blocks)`); }
      continue;
    }
    if (main === null) {
      if (here !== null) { rmSync(p); moved.push(o); }
    } else if (here !== main) {
      writeFileSync(p, main);
      moved.push(o);
    }
  }
  return { ok: true, moved };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--base");
  const base = i > 0 ? process.argv[i + 1] : "origin/main";
  const cwd = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  const r = reset({ cwd, base });
  for (const m of r.moved) console.log(`land: whole-tree total back to ${base}'s copy (regenerated on main after the merge): ${m}`);
  process.exit(r.ok ? 0 : 1);
}
