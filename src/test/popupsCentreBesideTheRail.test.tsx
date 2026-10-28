/**
 * ITEM 2 of the 2026-10-28 shared-UI list (CLAUDE.md: centring is measured against the post-rail area). Every
 * dialog and centred sheet sat at `left: 50%` of the WINDOW: measured in WebKit at 1440, the Create sheet and the job
 * dialog were centred at x 720 while the page beside the rail is centred at 844 (248 + 1192 / 2), and the 768px job
 * dialog ran over the rail's edge (left 336). After (same build, ~/.lh-shots/b3-1028/s2): both at 844 at 1440, 636
 * at 1024, 574 at 900, the job dialog capped at 620px there so it stays 16px clear of the right edge.
 *
 * One shared layer, as the rail-inset rule asks: POPUP_DIALOG_CLS carries `popup-centred`, and ONE index.css rule
 * (rail open, desktop website only) moves its centre and caps its width. Class guard over the source: any other
 * fixed, window-centred box must carry `popup-centred` too, or be named below with its reason.
 *
 * @mutate src/components/ui/popupFooter.ts |   "popup-centred sm:inset-x-auto | "sm:inset-x-auto
 * @mutate src/index.css |     left: calc(50% + var(--desktop-sidebar-w) / 2);\n    /* Never wider | left: 50%;\n    /* Never wider
 * @mutate src/index.css |     width: min(100%, calc(100vw - var(--desktop-sidebar-w) - 2rem)); |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { POPUP_DIALOG_CLS } from "@/components/ui/popupFooter";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = process.cwd();

/** Window-centred fixed boxes that are not popups of the shared shell, each with why it may stay window-centred. */
const WINDOW_CENTRED_OK: Record<string, string> = {
  "src/components/BirthdayPopup.tsx": "a hugging w-auto toast-like card over the confetti; the shared rule's width cap would stretch it",
};

describe("popups centre beside the rail on the desktop website (item 2)", () => {
  it("the shared dialog class carries the hook", () => {
    expect(POPUP_DIALOG_CLS.split(/\s+/)).toContain("popup-centred");
  });

  it("DialogContent and a bottom SheetContent both render with it", () => {
    render(
      <Dialog open>
        <DialogContent><DialogHero title="Title" /></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog").className).toMatch(/\bpopup-centred\b/);
  });

  it("a centred sheet too", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom"><SheetHero title="Title" /></SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("dialog").className).toMatch(/\bpopup-centred\b/);
  });

  it("ONE rule in index.css moves the centre and caps the width, only with the rail open on the desktop website", () => {
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    const rule = /html\.web-desktop\.desktop-rail\.side-panel-open \.popup-centred \{([^}]*)\}/.exec(css);
    expect(rule, "the rail-inset rule for popups is gone").not.toBeNull();
    expect(rule![1]).toMatch(/left: calc\(50% \+ var\(--desktop-sidebar-w\) \/ 2\);/);
    expect(rule![1]).toMatch(/width: min\(100%, calc\(100vw - var\(--desktop-sidebar-w\) - 2rem\)\);/);
    expect(css.match(/\.popup-centred\b/g)?.length).toBe(1);
  });

  it("every other fixed, window-centred box carries the hook or is named (inventory from source)", () => {
    const files = walkSource([join(ROOT, "src/components"), join(ROOT, "src/pages")]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      const rel = relative(ROOT, f);
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/["'`]([^"'`]*)["'`]/g)) {
        const cls = m[1];
        if (!/(^|\s)fixed(\s|$)/.test(cls)) continue;
        if (!/(^|\s)(sm:|md:|lg:)?left-(1\/2|\[50%\])(\s|$)/.test(cls)) continue;
        seen.add(rel);
        if (/\bpopup-centred\b/.test(cls) || rel in WINDOW_CENTRED_OK) continue;
        offenders.push(`${rel}: ${cls.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
    // The scan sees window-centred boxes at all: the named one is among them.
    for (const f of Object.keys(WINDOW_CENTRED_OK)) expect(seen.has(f), f).toBe(true);
    for (const f of Object.keys(WINDOW_CENTRED_OK)) {
      expect(readFileSync(join(ROOT, f), "utf8"), `${f} no longer has a window-centred box: drop it from the list`).toMatch(/fixed left-1\/2/);
    }
  });
});
