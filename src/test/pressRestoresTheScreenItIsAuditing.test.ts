/*
 * CLASS GUARD: the sweep must not press one screen's inventory against another
 * screen.
 *
 * The press loop enumerates a route's controls, then presses them one at a
 * time, restoring the page between presses when it has CHANGED. Its restore
 * condition covered three cases — an explicit `pageDirty`, a page not at rest,
 * and an open overlay — and none of them is "we navigated away".
 *
 * That gap is invisible while the control DISAPPEARS: the missing-control
 * branch asks `sameScreen()` and dispositions it. It is fully visible the
 * moment a control PERSISTS ACROSS ROUTES. The bottom nav does exactly that,
 * so it keeps resolving on the new page, nothing re-addresses it, nothing
 * skips it, and the click spends its whole 16s budget on an element belonging
 * to another screen's layout.
 *
 * MEASURED, run 35768341847: `[/jobs/7d315f44… customer]` found 19 controls,
 * pressed 2, failed 4 — "Posts", "Jobs", "Messages", "Profile", each
 * "NOT CLICKABLE: locator.click: Timeout 16000ms exceeded". The resolved
 * element in the log is `<button aria-label="Posts" aria-current="page" …>`;
 * `aria-current="page"` means the browser was already on /my-posts. The job
 * does not exist on prod (a `select` on that id returns no row), so the route
 * bounced and the sweep carried on pressing the old inventory.
 *
 * Four fabricated product defects on one page. A sweep that invents defects is
 * worse than one that misses them — it sends someone to fix nothing, and it
 * teaches the reader to distrust the red.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FILE = "scripts/audit/press-every-control.mjs";
const src = readFileSync(join(__dirname, "..", "..", FILE), "utf8");

/** Executable text only — a comment describing the guard is not the guard. */
const code = blankComments(src);

describe("press restores the screen it is auditing", () => {
  it("read a real file (cannot pass vacuously)", () => {
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toContain("sameScreen");
  });

  it("re-loads before a press when the URL has drifted off the audited route", () => {
    // The restore condition must consult sameScreen(). Matched on the
    // condition's own text rather than a line number so ordinary edits nearby
    // do not break it.
    // 3000, not 400: `blankComments` BLANKS comments to spaces rather than
    // deleting them (deleting is what guardsDoNotDeleteSource.test.ts forbids,
    // because a `/`+`*` inside a URL swallows the rest of a file). The
    // condition therefore carries its explanatory comment as whitespace, and a
    // tight window stopped matching the moment the stripper became safe.
    const cond = code.match(/else if \(([\s\S]{0,3000}?)\)\s*\{\s*await load\(\);/);
    expect(cond, "the restore-before-press branch must still exist").toBeTruthy();
    expect(
      cond![1],
      "The restore condition must include `!sameScreen(page.url())`. Without it, a " +
        "press that navigates leaves every remaining queued control being pressed " +
        "against the wrong page — and a control that persists across routes (the " +
        "bottom nav) resolves there, so nothing catches it.",
    ).toContain("!sameScreen(page.url())");
  });

  it("still restores for the three original reasons", () => {
    // Adding the navigation case must not displace the ones that were there.
    const cond = code.match(/else if \(([\s\S]{0,3000}?)\)\s*\{\s*await load\(\);/)![1];
    for (const clause of ["pageDirty", "!atRest()", "OPEN_OVERLAY"]) {
      expect(cond, `restore condition lost its "${clause}" clause`).toContain(clause);
    }
  });

  it("sameScreen still compares path + tab + view, not the raw URL", () => {
    // The guard is only as good as this comparison. A raw-URL equality check
    // would fire on every `?highlight=` the app adds to its own URL and
    // reload the page constantly.
    expect(code).toMatch(/x\.pathname \+ "\|" \+ \(x\.searchParams\.get\("tab"\)/);
  });
});

// Proof this is able to fail: drop the navigation clause and the sweep goes
// back to pressing one screen's controls on another.
// @mutate scripts/audit/press-every-control.mjs | !sameScreen(page.url()) | false
