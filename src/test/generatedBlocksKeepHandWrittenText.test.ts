/*
 * GUARD (2026-10-03): a refresh never deletes hand-written text silently.
 *
 * The nine questions held for the owner on 2026-10-03 (CodeQL required, push
 * protection, two live Connect accounts, preview branches, Vercel Pro, a
 * ruleset, apex links, loading states, SECURITY.md) were written between the
 * queue-count markers in docs/OPEN.md. land.sh's refresh after a rebase
 * (8f3dae96a, "chore: refresh generated inventories") rewrote the block and
 * deleted them; the owner's answers then had no line to land on, and five of
 * them were still undone and untracked the next morning.
 *
 * Since 2026-10-05 docs/OPEN.md has NO generated block at all (owner: OPEN.md
 * holds items only; the counts moved to docs/SCOREBOARD.md, written on main by
 * the inventories bot), so nothing regenerates any line of it. The one block
 * left, the Everything-open block in docs/SCOREBOARD.md, keeps the rule: its
 * writer refuses, exit 1, while the block holds a line its generator could
 * not have written (scripts/lib/openQueue.mjs foreignLines). Red first: the
 * replayed block below is 10 foreign lines.
 */
// @mutate scripts/lib/openQueue.mjs |     .filter((l) => l.trim() && !isCommentLine(l) && !shapes.some((re) => re.test(l))); |     .filter(() => false);
// @mutate scripts/scoreboard.mjs |     process.exit(1);\n  }\n  const sb = renderScoreboard(local, sbLive, renderOpenBlock( |     process.exitCode = 0;\n  }\n  const sb = renderScoreboard(local, sbLive, renderOpenBlock(
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { foreignLines } from "../../scripts/lib/openQueue.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { OPEN_BLOCK_SHAPES, localRows, renderOpenBlock } from "../../scripts/scoreboard.mjs";

const ROOT = join(__dirname, "..", "..");
const COUNT = "**Queue: 3 items — 1 done, 1 partly done (fixed, protection pending), 1 open.**";
// The block as it stood before 8f3dae96a (first lines of each question, verbatim).
const HELD = [
  COUNT,
  "",
  "**HELD 2026-10-03 (ask only when main is current, one pop-up per sub-choice):**",
  '- Make the "CodeQL" check REQUIRED on main? It fails a PR that adds an alert.',
  "- Turn on secret-scanning PUSH PROTECTION (secret scanning is on; push protection is off)?",
  "- Two LIVE Stripe Connect accounts (acct_1ULXMy3ISOxM8qBC, acct_1ULXMw40YhFTkeRO): keep or remove?",
  "- Two dead Supabase preview branches (from PR #253 and #235): delete?",
  "- When to move Vercel to Pro (needed by launch: Hobby caps deploys at 100/day, Q271)?",
  "- Ruleset 15556282 is inert (branch protection does the work): leave it, or delete it?",
  '- Apex universal links: clear "Redirect to www" on louisianahelpr.com in Vercel.',
  "- Loading-state check (#2148, Q429) is red because pre-launch prod shows EMPTY states.",
  "- Replace GitHub's template SECURITY.md (placeholder version table, no contact) with a real policy.",
].join("\n");

describe("generated blocks keep hand-written text", () => {
  it("RED replay: the block 8f3dae96a rewrote held 10 lines no generator writes", () => {
    expect(foreignLines(HELD, OPEN_BLOCK_SHAPES)).toHaveLength(10);
  });

  it("docs/OPEN.md has no generated block left for a refresh to rewrite", () => {
    expect(readFileSync(join(ROOT, "docs/OPEN.md"), "utf8")).not.toMatch(/<!-- \/?generated:/);
  });

  it("the block the generator writes for this tree holds only generated lines", () => {
    const block = renderOpenBlock(localRows(), null, readFileSync(join(ROOT, "docs/OPEN.md"), "utf8")) as string;
    expect(foreignLines(block, OPEN_BLOCK_SHAPES)).toEqual([]);
  });

  it("the scoreboard refuses, exit 1, before it writes a block holding a foreign line", () => {
    const src = readFileSync(join(ROOT, "scripts/scoreboard.mjs"), "utf8");
    const guard = src.indexOf('foreignLines(between(sbText ?? "", EO_START, EO_END) ?? "", OPEN_BLOCK_SHAPES)');
    expect(guard).toBeGreaterThan(0);
    const write = src.indexOf("writeFileSync(sbPath, sb)", guard);
    expect(write).toBeGreaterThan(guard);
    expect(src.slice(guard, write)).toMatch(/if \(foreign\.length\) \{[\s\S]*?process\.exit\(1\);\n {2}\}/);
  });
});
