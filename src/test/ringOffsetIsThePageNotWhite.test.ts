/**
 * ONE RING — and the offset band under it is the PAGE, never `#fff`.
 *
 * ─── WHAT WAS FOUND, AND HOW ───────────────────────────────────────────────
 *
 * The report was "the Share Your Location footer's Cancel has no focus ring
 * while Share Location Link does". Measured in headless Chromium against the
 * BUILT stylesheet (`dist/assets/*.css`) with the exact tailwind-merged class
 * strings the two primitives produce, once the 150ms `ease-ds-spring`
 * box-shadow transition had settled, BOTH resolve the identical ring:
 *
 *     rgb(240, 242, 244) 0 0 0 2px , rgb(95, 101, 67) 0 0 0 4px
 *
 * The reported reading (`outline` transparent, three `rgba(0,0,0,0) 0 0 0 0`
 * shadow layers) is what the SAME button measures once it has BLURRED —
 * reproduced exactly — and a partial ring (2.16px / 4.32px, the spring
 * overshooting its 2/4) is what it measures mid-transition. So that half of
 * the report did not reproduce.
 *
 * Checking the other shared close buttons it asked about DID turn up a real
 * one. Three of them — `DialogContent`'s ×, `anchoredPanel`'s ×,
 * `NotificationPanel`'s × — paint a Tailwind ring with `ring-offset-2` and
 * never pin `--tw-ring-offset-color`. Tailwind's preflight default for that
 * variable is `#fff`, so the 2px band between the control and its ring is
 * PURE WHITE rather than the page. Measured, same harness, `[data-theme=dark]`:
 *
 *     with    ring-offset-background : rgb(20, 22, 26) 0 0 0 2px   (the page)
 *     without                        : rgb(255,255,255) 0 0 0 2px   (a halo)
 *
 * against a `rgb(20, 22, 26)` ground. That is a third focus appearance in a
 * set of controls that do one job, and it is invisible in light mode, which is
 * why nobody caught it: `#fff` against `rgb(240,242,244)` is a 15/13/11 step.
 *
 * ─── WHY THIS IS A SOURCE CHECK ────────────────────────────────────────────
 *
 * jsdom applies no stylesheets, so a rendered assertion in vitest reads an
 * empty string for `box-shadow` and passes vacuously (the same reasoning
 * `controlInteractionSameness.test.ts` sets out). The RESOLVED values above
 * were measured in a real browser by hand, once; what a test can hold every
 * day is the rule that produces them — a ring's offset colour is declared, not
 * inherited from a framework default.
 *
 * @mutate src/components/ui/dialog.tsx | hover:text-foreground ring-offset-background focus-visible:outline-none | hover:text-foreground focus-visible:outline-none
 * @mutate src/components/ui/anchoredPanel.tsx | ctl-exit ctl-tint ring-offset-background focus-visible:outline-none | ctl-exit ctl-tint focus-visible:outline-none
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A class string that declares a ring OFFSET of non-zero width. `ring-offset-0`
 * is exempt on purpose: with no gap there is no band, so no colour to get
 * wrong.
 */
const DECLARES_OFFSET = /(?:^|[\s"'`])(?:focus(?:-visible|-within)?:)?!?ring-offset-[1-9]\d*(?![\w-])/;
/** …and pins the colour of that band to something of ours. */
const PINS_OFFSET_COLOUR =
  /(?:^|[\s"'`])(?:focus(?:-visible|-within)?:)?!?ring-offset-(?:background|card|popover|transparent|\[)/;

/**
 * THE HAND-BACK LEDGER — real violations in files this lane does not own
 * (`src/components/job-card`, `src/components/postjob`, `src/pages`, and
 * `NotificationPanel`/`ReportDialog`). Listed so the rule can land today and
 * they can be routed, not so they can be forgotten.
 *
 * IT MAY ONLY SHRINK. An entry that is no longer a violation fails below, so
 * it cannot rot into a permanent excuse — the same contract
 * `controlInteractionLedger.json` runs on.
 *
 * The one-line alternative to clearing them one by one, for whoever owns
 * `src/index.css`: `*, ::before, ::after { --tw-ring-offset-color: hsl(var(--background)); }`
 * makes the page the default for every control at once, at which point this
 * whole ledger and the four fixes beside it become belt-and-braces.
 */
const LEDGER = [
  "src/components/NotificationPanel.tsx",
  "src/components/ReportDialog.tsx",
  "src/components/TimePickerWheel.tsx",
  "src/pages/jobs/AppliedJobsTab.tsx",
  "src/pages/posts/postedJobs/DeclineApplicantSheet.tsx",
  "src/components/postjob/detailsSection/CategoryPicker.tsx",
  "src/components/postjob/detailsSection/CredentialTierSelector.tsx",
  "src/components/postjob/detailsSection/PhotoUpload.tsx",
  "src/pages/profile/AutoTip.tsx",
  "src/pages/profile/petProfiles/PetForm.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every quoted or backticked chunk of a file — one className's worth. A
 * template literal counts as ONE segment even with `${…}` holes in it, which
 * matters: several of these controls build their classes that way and the
 * offset and its colour must be in the same chunk to be in the same class
 * attribute.
 */
const SEGMENTS = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`((?:[^`\\]|\\.)*)`/gs;

export function offenders(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(SEGMENTS)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    if (!DECLARES_OFFSET.test(text)) continue;
    if (PINS_OFFSET_COLOUR.test(text)) continue;
    out.push(file);
  }
  return [...new Set(out)];
}

const FILES = walk("src");
const violations = [
  ...new Set(FILES.flatMap((f) => offenders(f, readFileSync(f, "utf8")))),
].sort();

describe("a focus ring's offset band is the page, not Tailwind's #fff", () => {
  it("has a real inventory — controls that declare a ring offset at all", () => {
    // FLOOR. If the detector stopped matching, every assertion below would
    // pass on an empty set, which is the vacuity this repo refuses.
    const declaring = FILES.filter((f) => DECLARES_OFFSET.test(readFileSync(f, "utf8")));
    expect(declaring.length, "no ring-offset declarations found — the detector is broken").toBeGreaterThan(15);
    expect(declaring).toContain("src/components/ui/button.tsx");
    expect(declaring).toContain("src/components/ui/dialog.tsx");
  });

  it("catches a close button that leaves the offset colour to the framework", () => {
    const before = `<button className="rounded-full ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] focus-visible:ring-offset-2" />`;
    expect(offenders("x.tsx", before)).toEqual(["x.tsx"]);
    const after = before.replace("ctl-tint ", "ctl-tint ring-offset-background ");
    expect(offenders("x.tsx", after)).toEqual([]);
    // ring-offset-0 has no band, so nothing to colour.
    expect(offenders("x.tsx", `<div className="focus-visible:ring-2 ring-offset-0" />`)).toEqual([]);
  });

  it("no unledgered control leaves its ring offset white", () => {
    const bad = violations.filter((f) => !LEDGER.includes(f));
    expect(
      bad,
      "add `ring-offset-background` beside the ring — without it the 2px band is #fff, a white halo in dark mode",
    ).toEqual([]);
  });

  it("the ledger only shrinks — a fixed file must be removed from it", () => {
    for (const f of LEDGER) {
      expect(violations, `${f} is clean now — delete it from LEDGER`).toContain(f);
    }
  });

  it("the shared popup chrome is fixed, not ledgered", () => {
    for (const f of [
      "src/components/ui/dialog.tsx",
      "src/components/ui/sheet.tsx",
      "src/components/ui/anchoredPanel.tsx",
      "src/components/ui/checkbox.tsx",
      "src/components/ui/badge.tsx",
      "src/components/ui/button.tsx",
    ]) {
      expect(violations, `${f} is shared chrome and must pin its own offset colour`).not.toContain(f);
    }
  });
});
