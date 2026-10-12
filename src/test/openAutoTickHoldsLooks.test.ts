/**
 * CLASS GUARD (owner, 2026-10-12): the auto-tick never closes an item that
 * still owes a look or a manual step on its unit tests alone.
 *
 * The bug: the nightly `open-done-when.mjs --tick` (bot PR #2899) ticked
 * Q1327, Q1402, Q1465, Q1504, Q1537, Q1558 and Q1646 because their done-when
 * tests passed, while each line still said a screenshot or a look on prod was
 * owed ("Left: a 375 look", "screenshot pending", "tick once live and LOOKED
 * at"). Q1504 was really still broken on prod; Q1646's WebKit paint defect was
 * still on main.
 *
 * FIXTURE: those seven lines exactly as they stood before the tick
 * (src/test/fixtures/autoTickOwedLook/ticked-2026-10-12.txt, copied from the
 * archive with the auto-tick note removed). INVENTORY: every `[~]` item on
 * docs/OPEN.md today, which is what the next --tick reads.
 */
// @mutate scripts/open-done-when.mjs |     if (owed) held.push([it.id, owed]); |     void owed;
// @mutate scripts/open-done-when.mjs |     for (const [id, owed] of heldForOwedLook(md, readyIds.keys())) { |     for (const [id, owed] of []) {
// @mutate scripts/open-done-when.mjs |   /\bleft:[^.]{0,300}?\b(?:look\|looks\|looked\|screenshots?\|owner'?s (?:phone\|iphone)\|on a device\|simulator\|testflight)\b/i, // "Left: a 375 look ..." |
// @mutate scripts/open-done-when.mjs |   return released > last ? null : words; |   return words;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { heldForOwedLook, owedLook } from "../../scripts/open-done-when.mjs";
import { queueItems } from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const FIXTURE = readFileSync(join(ROOT, "src/test/fixtures/autoTickOwedLook/ticked-2026-10-12.txt"), "utf8");
const SEVEN = ["Q1327", "Q1402", "Q1465", "Q1504", "Q1537", "Q1558", "Q1646"];

describe("auto-tick holds an item that still owes a look", () => {
  it("holds every one of the seven items the 2026-10-12 nightly ticked on tests alone", () => {
    const ids = queueItems(FIXTURE).map((it: { id: string }) => it.id);
    expect(ids).toEqual(SEVEN);
    const held = heldForOwedLook(FIXTURE, SEVEN);
    expect(held.map(([id]) => id)).toEqual(SEVEN);
  });

  it("each pattern family reads an outstanding step", () => {
    for (const owed of [
      "Built. Tick once live and LOOKED at.",
      "Left: a 375 look at a crew member's collapsed card before ticking.",
      "**BUILT 2026-10-12 (lane 4), screenshot pending:** the row is a flex sibling.",
      "The milestone screenshots are still not looked at: artifact downloads are refused.",
      "Needs a look at 1440.",
      "Fixed in CSS; the WebKit look goes to the browser agent.",
      "left: see it on the owner's phone on the next TestFlight build.",
      "tick after an e2e-journeys run is green on that step and the milestone at 375 has been looked at.",
    ]) {
      expect(owedLook(owed), owed).not.toBeNull();
    }
  });

  it("does not hold an item whose look is past, or released after the owed step", () => {
    for (const fine of [
      "Guard src/test/x.test.ts. done-when: test src/test/x.test.ts",
      "**LOOKED AT on prod 2026-10-12:** circle and title line up at 320, 375 and 1440.",
      "Looked at milestone edit-profile-dirty (chromium 390): no dock over the bar.",
      "Left: the perTest budget, then a green scheduled run.",
      "Left: a 375 look at the card. look: done 2026-10-13 poster card at 375 on prod, review recorded.",
    ]) {
      expect(owedLook(fine), fine).toBeNull();
    }
    // A release BEFORE a newer owed step does not release it.
    expect(owedLook("look: done 2026-10-11 first pass. Left: a 375 look at the fixed row.")).not.toBeNull();
  });

  it("runs on what the next --tick reads, and holds some of it (the guard is not vacuous)", () => {
    const md = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    const partly = queueItems(md).filter((it: { text: string }) => /^- \[~\] /.test(it.text));
    expect(partly.length).toBeGreaterThan(10);
    const held = heldForOwedLook(md, partly.map((it: { id: string }) => it.id));
    expect(held.length).toBeGreaterThan(0);
    expect(held.length).toBeLessThan(partly.length);
  });

  it("--tick consults it before writing a tick", () => {
    const src = readFileSync(join(ROOT, "scripts/open-done-when.mjs"), "utf8");
    const at = src.indexOf("for (const [id, owed] of heldForOwedLook(md, readyIds.keys())) {");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("writeFileSync(file, tickReady(", at)).toBeGreaterThan(at);
  });
});
