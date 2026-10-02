/*
 * GUARD (one open list, 2026-10-02): a doc section headed as open work cites
 * the OPEN.md item that owns it.
 *
 * Owner, 2026-10-02: "things are tracked in multiple places, fix all of this".
 * onlyOneOpenList.test.ts catches the loud kind of second list (`- [ ]` boxes, a
 * TODO title, a list-named file). The quiet kind is a prose section, such as
 * "## Still open", "## Follow-ups" or "## Open questions", whose items nobody
 * counts. On origin/main 672ffe2e7, six such sections cited no Q number, bus id
 * or OPEN.md. Two of them were already tracked:
 *   - the q441 tax research questions are Q374 and Q441;
 *   - the parity-matrix "Still open" items are Q54 and Q782, both done.
 * Those two now cite their items. The other four are UNTRACKED_OPEN_SECTIONS
 * below, until each is filed as a Q item and its section cites it.
 *
 * Also checked: the generated audit ROLLUP says that open work lives in
 * OPEN.md. It is a record of findings, not a second to-do list.
 *
 * Exempt:
 *   - docs/archive/: done-item history.
 *   - docs/OPEN.md: the list itself.
 *   - docs/audit/morning/: dated, generated morning pages that snapshot OPEN.md.
 *   - headings marked "(resolved".
 */
// @mutate scripts/lib/openWorkSections.mjs | if (!QUEUE_REF.test(section)) out.push | if (false) out.push
// @mutate docs/audit/parity-matrix-2026-09-26.md | Tracked as Q54 in docs/OPEN.md, with F1 moved to Q782 | Tracked as Q-54 in the queue, with F1 moved later
// @mutate scripts/audit-bus.mjs | "Open work is tracked ONLY in [docs/OPEN.md] | "Open work is tracked in [the queue]
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { uncitedOpenSections } from "../../scripts/lib/openWorkSections.mjs";

const ROOT = join(__dirname, "..", "..");

/**
 * Open-work sections that cite no OPEN.md item, by `file:heading`. Each one is
 * untracked open work: file a Q item for it, cite that Q in the section, and
 * delete the entry here in the same commit.
 */
// @two-way src/test/openWorkSectionsCiteQueue.test.ts:allowlisted section now cites the queue
const UNTRACKED_OPEN_SECTIONS: Record<string, string> = {
  "docs/FABLE_LEAD_AUDIT_PROMPT.md:## Open questions — surface, don't silently fix":
    "UNTRACKED (2026-10-02): lowercase 'helper' on admin screens, mixed document-title conventions, ~230 dead toasts; needs a Q item",
  "docs/function-grant-guard.md:## Pre-existing backlog (predates the guard)":
    "UNTRACKED (2026-10-02): functions with no explicit GRANT/REVOKE in the migration history; needs a Q item to triage them",
  "docs/ios-simulator-smoke.md:## Phase 2 — Maestro automation (not done yet)":
    "UNTRACKED (2026-10-02): Maestro automation of the simulator smoke flows; needs a Q item or a decision to drop it",
  "docs/qa/TESTFLIGHT_SMOKE_TEST.md:## Out-of-scope for this build but flag for follow-up":
    "UNTRACKED (2026-10-02): Helpr Pass wallet certs, Saved-Helper availability push cron, true heatmap; needs a Q item each",
};

const EXEMPT = (f: string) => f === "docs/OPEN.md" || f.startsWith("docs/archive/") || f.startsWith("docs/audit/morning/");

function trackedMarkdown(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("node_modules/"));
}

describe("open-work sections outside docs/OPEN.md cite the queue", () => {
  const files = trackedMarkdown().filter((f) => !EXEMPT(f));
  const found = new Map<string, number>();
  for (const f of files) {
    let md: string;
    try { md = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const s of uncitedOpenSections(md) as { line: number; heading: string }[]) found.set(`${f}:${s.heading}`, s.line);
  }

  it("scans the repo's markdown (floor)", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("the detector flags an uncited open section and passes cited, resolved and prose ones", () => {
    const md = [
      "# Doc",
      "## Still open", "1. ship the thing",
      "## Follow-ups", "- tracked as Q12",
      "## Next steps", "- see [docs/OPEN.md](OPEN.md)",
      "## Open questions (resolved 2026-07-06)", "- none left",
      "## The remaining explanation", "prose, not work",
      "## A fix is not done until its number moves", "a rule",
      "## /signup-pending", "a route",
      "## Backlog", "### Sub", "- bus finding ME-043",
    ].join("\n");
    expect((uncitedOpenSections(md) as { heading: string }[]).map((s) => s.heading)).toEqual(["## Still open"]);
  });

  it("every uncited open section is a known UNTRACKED entry (file a Q item and cite it)", () => {
    const rogue = [...found].filter(([k]) => !(k in UNTRACKED_OPEN_SECTIONS)).map(([k, line]) => `${k.split(":")[0]}:${line} ${k.slice(k.indexOf(":") + 1)}`);
    expect(
      rogue,
      "Open work lives ONLY in docs/OPEN.md. File each item as a Q item (next free: node scripts/queue-count.mjs), " +
        "then cite the Q number in this section, or move the section's items into OPEN.md.",
    ).toEqual([]);
  });

  it("the allowlist is exact (two-way): an entry that now cites the queue is removed", () => {
    const stale = Object.keys(UNTRACKED_OPEN_SECTIONS).filter((k) => !found.has(k) || !existsSync(join(ROOT, k.split(":")[0])));
    expect(stale, "allowlisted section now cites the queue (or is gone): delete its entry in this commit").toEqual([]);
    for (const [k, why] of Object.entries(UNTRACKED_OPEN_SECTIONS)) expect(why.length, `${k} needs a reason`).toBeGreaterThan(40);
  });

  it("the generated audit ROLLUP points at docs/OPEN.md as the one open list", () => {
    const rollup = readFileSync(join(ROOT, "docs/audit/launch-2026-09/ROLLUP.md"), "utf8");
    expect(rollup).toContain("Open work is tracked ONLY in [docs/OPEN.md](../../OPEN.md)");
    expect(readFileSync(join(ROOT, "scripts/audit-bus.mjs"), "utf8")).toContain("Open work is tracked ONLY in [docs/OPEN.md]");
  });
});
