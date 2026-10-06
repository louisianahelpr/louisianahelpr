/*
 * CLASS GUARD (owner, 2026-10-05): ONE allocator mints docs/OPEN.md queue numbers.
 *
 * Different lanes and bots picked the same next Q number (bot PR #2372 added
 * Q1378-Q1380 for feed items while main filed the crew items as Q1378-Q1380).
 * Each writer that mints a `**Q<n>**` did its own arithmetic: queue-count's
 * `Q${max + 1}`, open-renumber's and openFeeds' `Q${next++}`. They now all take
 * numbers from scripts/lib/queueAllocator.mjs (max of origin/main's OPEN.md +
 * archives and every number this tree already uses, plus one; qCounter hands
 * them out).
 *
 * INVENTORY: every script under scripts/ (read from disk, comments blanked).
 *   1. No Q-number arithmetic (`Q${... + 1}`, `Q${n++}`, `"Q" + (n + 1)`, a
 *      Python f"Q{n + 1}") anywhere but the allocator.
 *   2. Every script that writes a new open head line (`- [ ] **${...}`) imports
 *      the allocator.
 *   3. Every caller of applyFeeds / renumberPlan hands it nextFreeNumber(...).
 * ~/.lh-tools/open_apply_branch.py is local only (not in this repo) and is not
 * covered; it is named in the allocator's header.
 */

// @mutate scripts/lib/openFeeds.mjs |     const id = take(); |     const id = `Q${nextFree + created.length}`;
// @mutate scripts/open-renumber.mjs |       const to = take(); |       const to = `Q${nextFree++}`;
// @mutate scripts/lib/openFeeds.mjs | import { qCounter } from "./queueAllocator.mjs"; | const qCounter = (n) => () => "Q" + n;
// @mutate scripts/open-sync-trackers.mjs | nextFree: nextFreeNumber(ROOT) | nextFree: 1

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs script, no declaration file
import { qCounter, nextFreeId } from "../../scripts/lib/queueAllocator.mjs";

const ROOT = join(__dirname, "..", "..");
const SCRIPTS = join(ROOT, "scripts");
const ALLOCATOR = "scripts/lib/queueAllocator.mjs";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(mjs|cjs|js|ts|mts|sh|py)$/.test(name) && !/\.d\.mts$/.test(name)) out.push(p);
  }
  return out;
}

/** Source with comments blanked: JS through the shared helper, shell/Python `#` lines dropped. */
function code(path: string): string {
  const src = readFileSync(path, "utf8");
  if (/\.(sh|py)$/.test(path)) return src.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l)).join("\n");
  return blankComments(src);
}

/** Q-number arithmetic: the shapes a minter writes. */
const MINT_SHAPES: RegExp[] = [
  /Q\$\{[^}]*(\+\+|\+\s*\d|\+\s*[A-Za-z_])/, // `Q${max + 1}`, `Q${next++}`, `Q${base + i}`
  /["'`]Q["'`]\s*\+\s*\(?\s*[\w.]+\s*(\+\+|\+\s*\d)/, // "Q" + (max + 1)
  /f["']Q\{[^}]*\+/, // Python f"Q{n + 1}"
  /["']Q%d["']\s*%\s*\(?\s*[\w.]+\s*\+/, // "Q%d" % (n + 1)
];
const NEW_HEAD = /- \[ \] \*\*\$\{/;

const files = walk(SCRIPTS).sort().map((p) => ({ rel: relative(ROOT, p), src: code(p) }));

describe("queue numbers come from the one allocator", () => {
  it("reads the scripts inventory (floor) and the allocator is in it", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => f.rel)).toContain(ALLOCATOR);
  });

  it("the allocator hands out consecutive ids and never a used one", () => {
    const take = qCounter(1392);
    expect([take(), take(), take()]).toEqual(["Q1392", "Q1393", "Q1394"]);
    expect(nextFreeId("- [ ] **Q7 a.**\n- [x] **Q1380 b.**\nsee **Q12**")).toBe("Q1381");
    expect(() => qCounter(0)).toThrow();
  });

  it("no script outside the allocator does arithmetic on a Q number", () => {
    const hits = files
      .filter((f) => f.rel !== ALLOCATOR)
      .flatMap((f) => f.src.split("\n").map((l, i) => ({ f: f.rel, i: i + 1, l })))
      .filter((x) => MINT_SHAPES.some((re) => re.test(x.l)))
      .map((x) => `${x.f}:${x.i}  ${x.l.trim().slice(0, 140)}`);
    expect(hits, "mint queue numbers with qCounter / nextFreeNumber from scripts/lib/queueAllocator.mjs").toEqual([]);
  });

  it("the allocator itself is the minter the shapes catch (the scan can fail)", () => {
    const own = files.find((f) => f.rel === ALLOCATOR)?.src ?? "";
    expect(MINT_SHAPES.some((re) => own.split("\n").some((l) => re.test(l)))).toBe(true);
  });

  it("every script that writes a new open head line imports the allocator", () => {
    const writers = files.filter((f) => NEW_HEAD.test(f.src));
    expect(writers.map((f) => f.rel)).toContain("scripts/lib/openFeeds.mjs");
    const without = writers.filter((f) => f.rel !== ALLOCATOR && !/from\s+["'][./]*(lib\/)?queueAllocator\.mjs["']/.test(f.src)).map((f) => f.rel);
    expect(without).toEqual([]);
  });

  it("every caller of applyFeeds / renumberPlan numbers from nextFreeNumber", () => {
    const callers = files.filter((f) => /\b(applyFeeds|renumberPlan)\(\s*[^)]/.test(f.src.replace(/export function (applyFeeds|renumberPlan)\(/g, "")));
    expect(callers.map((f) => f.rel).sort()).toEqual(["scripts/open-renumber.mjs", "scripts/open-sync-trackers.mjs"]);
    for (const c of callers) expect(c.src, c.rel).toMatch(/\b(applyFeeds|renumberPlan)\([^;]*nextFreeNumber\(/);
  });
});
