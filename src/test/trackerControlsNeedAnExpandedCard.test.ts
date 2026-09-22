/*
 * CLASS GUARD: a spec that drives the helper's job TRACKER must open the card first.
 *
 * `JobCardShell` renders every job card COLLAPSED. A collapsed card is a
 * summary — category, heading, price, location chip, one status sentence — and
 * it contains no tracker at all. `JobTracking`'s rung buttons ("I'm On My
 * Way", "I've Arrived", "Start Working", "Mark Job Complete") and
 * `PhotoProofCaptureChip`'s photo asks only exist once the card is open.
 *
 * THE DAY THIS COST, 2026-09-22. The full money loop against production — the
 * highest-stakes check in this repo — waited 30 seconds for
 * `^Before Photo — add the before photo for this job$` on a funded, hired,
 * in-progress job, then failed with "the card never asked for the before
 * photo". The failure artefact showed the card's ENTIRE accessible content as
 * `button "Expand Job Details"`, the heading, `$22`, the location chip and
 * `paragraph: Needs You — Finish and mark it done`. Nothing had gone wrong with
 * the product. The card was simply shut, and the spec never opened it.
 *
 * WHY THAT DIAGNOSIS TOOK SO LONG, and why the guard is worth having. The same
 * assertion had gone stale TWICE BEFORE, both times because a LABEL moved, and
 * both times the fix was recorded in a comment above the locator. So the third
 * failure — a different cause with an identical symptom — was read as a third
 * rename, and its own error message says "check the chip label in
 * PhotoProof.tsx has not moved again". A wrong hypothesis with two precedents
 * behind it is expensive; `e2eExactLocatorsMatchRealCopy.test.ts` already holds
 * the label half, and this holds the half it cannot see.
 *
 * THE INVENTORY IS THE APP'S. The control names are read out of
 * `src/components/JobTracking.tsx` and `src/components/PhotoProof.tsx` rather
 * than listed here, so a rung this repo adds later is covered the day it ships.
 *
 * THE SIGNAL FOR "opens the card" is the `role="group" aria-label="Job
 * progress"` row that `JobTracking.tsx` renders (its step rail) — the same
 * thing `02-marketplace.spec.ts`'s `card()` helper waits on to prove a card
 * opened. Checking for the gesture instead (a heading click, the sr-only
 * "Expand Job Details" button) would pass a spec that clicks and never
 * confirms, which is the bug.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * The tracker's own control names, read out of the components that render
 * them. `JobTracking` spells its rungs as button labels; `PhotoProof` builds
 * its chip's accessible name from a template, so the stable, searchable part of
 * that template is what a spec must be matching.
 */
function trackerControlNames(): string[] {
  const tracking = readFileSync(resolve(ROOT, "src/components/JobTracking.tsx"), "utf8");
  const names = new Set<string>();

  // The rung labels, as the component writes them.
  for (const m of tracking.matchAll(/"(I'm On My Way|I've Arrived|Start Working|Mark Job Complete)"/g)) {
    names.add(m[1]);
  }

  // PhotoProof.tsx:195 — aria-label={`${triggerText} — add the ${type} photo for this job`}
  const photo = readFileSync(resolve(ROOT, "src/components/PhotoProof.tsx"), "utf8");
  if (photo.includes("— add the ${type} photo for this job")) {
    names.add("photo for this job");
  }

  return [...names];
}

describe("tracker controls are only reachable on an expanded card", () => {
  it("every e2e spec that locates one also proves the card opened", () => {
    const controls = trackerControlNames();
    expect(controls.length, "read no tracker control names out of the components").toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const file of walk(resolve(ROOT, "e2e"))) {
      const src = blankComments(readFileSync(file, "utf8"));

      /* Only a LOCATOR counts. `stateMatrix.ts` names three of these rungs in
         prose that describes which controls a state should show — a sentence
         about a button is not a spec pressing one. So each `getBy*(` call's
         argument region is scanned rather than the whole file. The window
         spans lines because the money loop's own chip locator builds its name
         with `new RegExp(...)` on the line after `getByRole(`. */
      const hits: string[] = [];
      for (const m of src.matchAll(/getBy(?:Role|Text|Label|TestId)\(/g)) {
        const region = src.slice(m.index!, m.index! + 240);
        for (const control of controls) {
          if (region.includes(control)) hits.push(control);
        }
      }
      if (hits.length === 0) continue;

      if (!src.includes("Job progress")) {
        offenders.push(
          `${file.slice(ROOT.length + 1)} locates ${[...new Set(hits)].map((h) => `"${h}"`).join(", ")} ` +
            `but never waits on the "Job progress" step rail, so it never proves the card is open`,
        );
      }
    }

    expect(
      offenders,
      "A collapsed job card renders NO tracker. A spec that reaches for a rung button or a photo " +
        "chip without opening the card first waits out its timeout and then fails in language that " +
        'reads like a broken completion flow — "the card never asked for the before photo" on a ' +
        "funded, hired job.\n\n" +
        "Open the card the way e2e/journeys/02-marketplace.spec.ts does: click the card's level-2 " +
        'heading, then wait for `getByRole("group", { name: /Job progress/ })`. Do not assert on the ' +
        'sr-only "Expand Job Details" button — its accessible name flips to "Collapse Job Details".\n\n' +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// The exact fault this guard was built from: the money loop reaching for the
// before-photo chip on a card it never opened. Removing the expansion block
// from prod-lifecycle.spec.ts is the 2026-09-22 failure, restored.
// @mutate e2e/prod-lifecycle.spec.ts | const progress = card.getByRole("group", { name: /Job progress/ }); | const progress = card.getByRole("button", { name: /nothing/ });
