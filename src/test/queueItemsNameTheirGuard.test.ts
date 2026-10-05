// @mutate scripts/queue-count.mjs | return [...seen].filter(([, n]) => n > 1) | return [...seen].filter(([, n]) => n > 99)
// @mutate docs/archive/OPEN-done-2026-09.md | Class check: src/lib/jobDayHasEnded.tz.test.ts sweeps | Class check: a tz sweep
/*
 * A queue item is not DONE until something stops it from recurring.
 *
 * Owner, 2026-09-23: "All of these things need to be sure they do not happen
 * again in the future. Everything needs to be checked for protection in the
 * future." Every `- [x] **Qnn` item in docs/OPEN.md must name, in its own
 * text, at least one guard that EXISTS in the repo (a test, a check script, a
 * workflow or a migration), or state `NO-GUARD: <reason>` for the rare item
 * where no recurrence is possible (a one-off data fact, a deleted feature
 * with nothing left to regress).
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { queueCounts, countLine, duplicateIds, nextFreeId } from "../../scripts/queue-count.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { localRows, renderOpenBlock } from "../../scripts/scoreboard.mjs";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs module, no declaration file
import { queueText } from "../../scripts/lib/openQueue.mjs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
// OPEN.md + its done archives (scripts/lib/openQueue.mjs, Q16): an archived done
// item must still name its guard, and still count.
const open = queueText(ROOT);

/** Each done queue item's full text (from its line to the next list item or heading). */
export function doneItems(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^- \[x\] \*\*(Q\d+)\b/.exec(lines[i]);
    if (!m) continue;
    let text = lines[i];
    for (let j = i + 1; j < lines.length && !/^(- \[|#)/.test(lines[j]); j++) text += "\n" + lines[j];
    out.push({ id: m[1], text });
  }
  return out;
}

const GUARD_PATH = /(?:src\/test\/|src\/[\w/.-]+\.test\.tsx?|scripts\/[\w/.-]+\.m?js|\.github\/workflows\/[\w.-]+\.yml|supabase\/migrations\/\d+_[\w-]+\.sql|e2e\/[\w/.-]+\.spec\.ts)[\w/.-]*/g;
// Bare test/script names in prose (e.g. "adminIdBadgeStates.test.tsx").
const BARE = /\b([\w-]+\.(?:test|spec)\.tsx?|check-[\w-]+\.mjs|[\w-]+\.tz\.test\.tsx?)\b/g;

function guardsNamed(text: string): string[] {
  const found = new Set<string>();
  for (const p of text.match(GUARD_PATH) ?? []) {
    const clean = p.replace(/[.,;:)]+$/, "");
    if (existsSync(join(ROOT, clean))) found.add(clean);
  }
  for (const m of text.matchAll(BARE)) {
    const name = m[1];
    for (const dir of ["src/test", "scripts", "src/lib", "src/components", "src/pages", "e2e"]) {
      try {
        const hit = execFind(dir, name);
        if (hit) { found.add(hit); break; }
      } catch { /* dir absent in a partial checkout: not a guard */ }
    }
  }
  return [...found];
}

import { statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
function execFind(dir: string, name: string): string | null {
  const abs = join(ROOT, dir);
  const stack = [abs];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d)) {
      if (e === "node_modules") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (e === name) return p.slice(ROOT.length + 1);
    }
  }
  return null;
}

describe("every DONE queue item names the guard that stops it recurring", () => {
  const items = doneItems(open);

  it("found the done items (cannot pass vacuously)", () => {
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it("each names an existing guard, or says NO-GUARD with a reason", () => {
    const missing = items
      .filter((it) => !/NO-GUARD:\s*\S/.test(it.text) && guardsNamed(it.text).length === 0)
      .map((it) => it.id);
    expect(missing, "Name the test/script/workflow/migration that catches a recurrence, or 'NO-GUARD: <why nothing can recur>'").toEqual([]);
  });

  it("is RED on a done item with no guard", () => {
    const fake = "- [x] **Q999 DONE: fixed it.**\n";
    const f = doneItems(fake)[0];
    expect(!/NO-GUARD:/.test(f.text) && guardsNamed(f.text).length === 0).toBe(true);
  });
});

describe("the queue's count line is generated into SCOREBOARD, never kept in OPEN.md", () => {
  // Owner, 2026-10-05: OPEN.md holds items only. The line used to sit in a
  // generated block there, and every landing rewrote it and conflicted with
  // every other landing. scripts/scoreboard.mjs renders it (from these items)
  // into docs/SCOREBOARD.md on main; branches never write either. Judged on
  // the generator's output for THIS tree, never on the committed SCOREBOARD
  // (a branch leaves that stale by design).
  it("OPEN.md carries no count line and no generated block", () => {
    const md = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    expect(md.split("\n").filter((l) => /^\*\*Queue: \d+ items/.test(l))).toEqual([]);
    expect(md).not.toContain("<!-- generated:");
  });

  it("the Everything-open block the bot writes carries the exact count of these items", () => {
    const c = queueCounts(open);
    expect(c.total).toBeGreaterThanOrEqual(40);
    const block = renderOpenBlock(localRows(), null, readFileSync(join(ROOT, "docs/OPEN.md"), "utf8")) as string;
    expect(block.split("\n")).toContain(countLine(c));
  });

  it("is RED when an item changes state: the line moves with it", () => {
    const before = "- [ ] **Q1 open**\n";
    const after = "- [x] **Q1 DONE**\n";
    expect(countLine(queueCounts(before))).not.toBe(countLine(queueCounts(after)));
  });
});

describe("every queue number is used once", () => {
  it("no two items share a Q number (take the next one from `node scripts/queue-count.mjs`)", () => {
    expect(duplicateIds(open)).toEqual([]);
  });

  it("is RED on a duplicated number", () => {
    expect(duplicateIds("- [ ] **Q7 a**\n- [x] **Q7 b**\n- [ ] **Q8 c**\n")).toEqual(["Q7"]);
    expect(nextFreeId("**Q7** **Q12**")).toBe("Q13");
  });
});
