import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * CLASS CHECK — a fixed-track grid may not be fed a conditionally-built array.
 *
 * THE ORIGINAL (owner, 2026-09-19, from a live /user/… screenshot): "this
 * should display 4 boxes always. even if it has zero data yet bc rn it looks
 * empty." `AtAGlanceCard` declared `sm:grid-cols-4` — a FIXED four-column
 * track — and then filled it from an array built by `cells.push(...)` behind
 * `if (count > 0)` guards. A member with one zero got three tiles and a dead
 * quarter of whitespace, which reads as a value that failed to load rather
 * than as a number that is genuinely zero.
 *
 * THE CLASS, not the instance: any component that declares a fixed column
 * track and then feeds it an array whose MEMBERSHIP is conditional can
 * under-fill that track. The two facts are in different places, so neither
 * one looks wrong on its own — which is exactly why this has to be checked
 * mechanically rather than read. The fix in every case is the same: declare
 * the array literally, with one entry per column, and vary the CONTENT of a
 * cell (a zero, a "New") rather than its EXISTENCE.
 *
 * THE INVENTORY IS THE APP'S OWN: every `.tsx` under `src/`, scanned for a
 * className that declares `grid-cols-N` (N a literal, at any breakpoint) on
 * an element that renders `{ident.map(` — then that same `ident` is checked
 * for `.push(` / `.unshift(` anywhere in the file. Both floors below fail
 * loudly if the scan finds nothing, so an inventory that silently goes empty
 * (a rename, a moved directory) is a failure rather than a pass.
 *
 * COMMENTS ARE STRIPPED BEFORE SCANNING. This file's own subject matter is
 * discussed at length in comments in AtAGlanceCard.tsx — including the
 * literal words `cells.push(` — and a guard that a comment can satisfy (or
 * trip) is not a guard. Three checks have been bitten by that already.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      tsxFiles(p, out);
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Block and line comments out, string contents preserved.
 *
 * Was a pair of deleting regexes. That chain makes 157 of 1,054 source files
 * lose REAL CODE (one loses 98% of its own), because a `/` + `*` inside a
 * string or regex literal opens a comment that runs to the next `*` + `/`
 * anywhere later in the file. This guard walks every `.tsx` under `src/`, so
 * it was scanning emptied text for an unknown share of them — and "found
 * nothing" is what it reports either way. The `[^:]` was a partial patch for
 * the same class, sparing `://` in URLs, which is the one symptom someone
 * happened to notice.
 */
const stripComments = (src: string): string => blankComments(src);

type Site = { file: string; ident: string; track: string; conditional: boolean };

/**
 * A push is an OFFENDER when the track is not filled BY CONSTRUCTION.
 *
 * Two ways that happens:
 *
 *  1. CONDITIONAL — the push sits behind an `if (`, so membership depends on a
 *     VALUE and a zero leaves a hole. This is the original defect.
 *
 *  2. DEFERRED — the push sits inside a JSX EVENT HANDLER (`onClick={() =>
 *     …}`), so it does not run at construction at all: the grid renders with
 *     one membership and changes to another when the user does something. That
 *     is strictly worse than (1) — the track is not merely under-filled, it
 *     moves under the reader.
 *
 * (2) was added 2026-09-21 because the nightly full mutation sweep caught this
 * guard SURVIVING its own registered mutation. `onCopy={() => cells.push(
 * cells[0])}` on the grid element has no preceding `if (` within the lookback,
 * so the old rule classified it "unconditional" and waved it through. The
 * guard's own header claimed it checked for `.push(` "anywhere in the file";
 * the code only ever asked what keyword preceded it. Trust the declaration,
 * not the comment beside it.
 *
 * A push inside an ARRAY-ITERATION callback is still fine and must stay fine —
 * `days.forEach((d) => cells.push(…))` fills the track by construction, which
 * is what ScheduleTab's month grid does. So the test is specifically a JSX
 * event-handler attribute, not "any arrow function".
 */
const JSX_HANDLER = /on[A-Z]\w*\s*=\s*\{/g;

function conditionalPush(src: string, ident: string): boolean {
  for (const m of src.matchAll(new RegExp(`\\b${ident}\\.(?:push|unshift)\\s*\\(`, "g"))) {
    const at = m.index ?? 0;
    const before = src.slice(Math.max(0, at - 200), at);
    const lastIf = before.lastIndexOf("if (");
    const lastLoop = Math.max(before.lastIndexOf("for ("), before.lastIndexOf("while ("));
    if (lastIf >= 0 && lastIf > lastLoop) return true;

    // Deferred: the nearest enclosing opener is a JSX event handler.
    let lastHandler = -1;
    for (const h of before.matchAll(JSX_HANDLER)) lastHandler = h.index ?? lastHandler;
    if (lastHandler >= 0 && lastHandler > lastLoop) return true;
  }
  return false;
}

/**
 * KNOWN, REPORTED, NOT FIXED HERE — a ratchet, not an excuse.
 *
 * This list may only SHRINK. An entry that stops being an offender fails the
 * first assertion below, so it cannot rot into a permanent exemption, and a
 * NEW offender fails too because the comparison is exact equality.
 *
 * `HelprWrapped.tsx` is a real instance of this exact class, found BY this
 * scan on the day it was written: nine `statCards.push()` calls, each behind
 * its own `> 0` test, feeding a `grid-cols-2` track — so an odd number of
 * non-zero stats strands the last card at half width, and a member with none
 * gets an empty grid. It is NOT fixed here because the owner's ruling named
 * the profile stat grid and nothing else, and reshaping a second screen
 * uninstructed is its own defect. Reported instead; fixing it deletes this
 * entry.
 */
const KNOWN_UNFIXED = [
  "src/pages/HelprWrapped.tsx: grid-cols-2 ← statCards (9 conditional pushes; odd count strands the last card)",
];

/**
 * A "fixed-track grid fed by a mapped array" site. `className` and the
 * `{ident.map(` do not have to be adjacent in the source (a long comment or a
 * style prop sits between them in practice), so the window is the JSX element:
 * from the `grid-cols-N` back to its `<`, forward to the matching close.
 * Approximated as "the 1200 characters after the track declaration", which is
 * wider than any grid in this repo and narrow enough not to reach the next
 * element — the assertion below proves the window finds the known site.
 */
function scan(): Site[] {
  const sites: Site[] = [];
  for (const file of tsxFiles(SRC)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/(?:^|[\s"'`:])(?:[a-z]+:)?grid-cols-\d+/g)) {
      const window = src.slice(m.index ?? 0, (m.index ?? 0) + 1200);
      const mapped = window.match(/\{\s*([A-Za-z_$][\w$]*)\s*\.map\(/);
      if (!mapped) continue;
      const ident = mapped[1];
      sites.push({ file: relative(ROOT, file), ident, track: m[0].trim(), conditional: conditionalPush(src, ident) });
    }
  }
  return sites;
}

// @mutate src/pages/userProfile/AtAGlanceCard.tsx | const cells: Cell[] = [ | const cells: Cell[] = []; if (postedJobsCount > 0) cells.push({ key: "x", icon: Star, value: "1", label: "y" }); const cellsLiteral: Cell[] = [
// @mutate src/pages/userProfile/AtAGlanceCard.tsx | className="grid grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-4" | className="grid grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-4" onCopy={() => cells.push(cells[0])}

describe("fixed-track grids are never fed a conditionally-built array", () => {
  const sites = scan();

  it("the scan has a real inventory to judge (floor — an empty scan is a failure)", () => {
    // The floor is the whole repo, not the one screen: if `tsxFiles` ever
    // returns nothing (a moved src/, a changed extension) every assertion
    // below passes vacuously.
    expect(tsxFiles(SRC).length, "no .tsx files were scanned at all").toBeGreaterThan(200);
    expect(sites.length, "no fixed-track grid rendering a mapped array was found anywhere in src/").toBeGreaterThan(0);
  });

  it("finds the profile stat grid — the site the owner reported", () => {
    // Pins the scanner to a known-real site so a regex that silently stops
    // matching cannot turn this whole file green.
    const atAGlance = sites.filter((s) => s.file.endsWith("userProfile/AtAGlanceCard.tsx"));
    expect(atAGlance.length, "AtAGlanceCard's stat grid is no longer detected by the scanner").toBeGreaterThan(0);
    expect(atAGlance.some((s) => s.ident === "cells")).toBe(true);
  });

  it("no fixed-track grid's array has conditional membership (beyond the ratchet)", () => {
    const offenders = [
      ...new Set(
        sites
          .filter((s) => s.conditional)
          .map((s) => `${s.file}: ${s.track} ← ${s.ident}`),
      ),
    ].sort();
    const knownFiles = new Set(KNOWN_UNFIXED.map((k) => k.split(":")[0]));
    const unexpected = offenders.filter((o) => !knownFiles.has(o.split(":")[0]));
    expect(
      unexpected,
      "a fixed column track fed by an array whose membership depends on a value — a zero leaves a hole in the track. Declare the array literally and vary the cell's CONTENT (a 0, a \"New\"), not its existence; see src/pages/userProfile/AtAGlanceCard.tsx",
    ).toEqual([]);

    // The ratchet: every KNOWN entry must still BE an offender. One that got
    // fixed has to be deleted from the list in the same change, so the
    // exemption cannot outlive the defect.
    const offenderFiles = new Set(offenders.map((o) => o.split(":")[0]));
    for (const k of KNOWN_UNFIXED) {
      expect(offenderFiles, `${k.split(":")[0]} is no longer an offender — delete its KNOWN_UNFIXED entry`).toContain(k.split(":")[0]);
    }
  });

  it("the profile stat grid is NOT on the ratchet — the owner's screen is actually fixed", () => {
    // The thing the class check exists for. If AtAGlanceCard ever reappears
    // as an offender, this fails whether or not someone allowlists it.
    const offenders = sites.filter((s) => s.conditional).map((s) => s.file);
    expect(offenders).not.toContain("src/pages/userProfile/AtAGlanceCard.tsx");
    expect(KNOWN_UNFIXED.join("\n")).not.toContain("AtAGlanceCard");
  });
});
