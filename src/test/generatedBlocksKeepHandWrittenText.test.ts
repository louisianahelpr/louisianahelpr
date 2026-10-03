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
 * Both writers of a block in docs/OPEN.md (queue-count --write and the
 * scoreboard's Everything-open block) now refuse, exit 1, while the block holds
 * a line their generator could not have written (scripts/lib/openQueue.mjs
 * foreignLines). Red first: the replayed block below is 10 foreign lines.
 */
// @mutate scripts/lib/openQueue.mjs |     .filter((l) => l.trim() && !isCommentLine(l) && !shapes.some((re) => re.test(l))); |     .filter(() => false);
// @mutate scripts/queue-count.mjs |       process.exit(1);\n    } |       process.exitCode = 0;\n    }
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { foreignLines } from "../../scripts/lib/openQueue.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { COUNT_LINE_SHAPE, START, END } from "../../scripts/queue-count.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { OPEN_BLOCK_SHAPES, EO_START, EO_END } from "../../scripts/scoreboard.mjs";

const ROOT = join(__dirname, "..", "..");
const between = (t: string, a: string, b: string) => t.slice(t.indexOf(a) + a.length, t.indexOf(b));
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

let dir = "";
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("generated blocks in docs/OPEN.md keep hand-written text", () => {
  it("RED replay: the block 8f3dae96a rewrote held 10 lines no generator writes", () => {
    expect(foreignLines(HELD, [COUNT_LINE_SHAPE])).toHaveLength(10);
  });

  it("today's blocks hold only generated lines", () => {
    const open = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    expect(foreignLines(between(open, START, END), [COUNT_LINE_SHAPE])).toEqual([]);
    expect(foreignLines(between(open, EO_START, EO_END), OPEN_BLOCK_SHAPES)).toEqual([]);
  });

  it("queue-count --write refuses, exit 1, and leaves the file as it was", () => {
    dir = mkdtempSync(join(tmpdir(), "lh-genblock-"));
    mkdirSync(join(dir, "docs/archive"), { recursive: true });
    const md = ["# Open", "", START, HELD, END, "", "- [ ] **Q1 MEDIUM an item.** text", ""].join("\n");
    writeFileSync(join(dir, "docs/OPEN.md"), md);
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/queue-count.mjs"), "--write"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("hand-written line(s) inside the generated block");
    expect(readFileSync(join(dir, "docs/OPEN.md"), "utf8")).toBe(md);
  });

  it("the scoreboard refuses before it splices the Everything-open block", () => {
    const src = readFileSync(join(ROOT, "scripts/scoreboard.mjs"), "utf8");
    const guard = src.indexOf("foreignLines(between(openText, EO_START, EO_END)");
    expect(guard).toBeGreaterThan(0);
    expect(src.indexOf("spliceOpen(openText, renderOpenBlock(", guard)).toBeGreaterThan(guard);
  });
});
