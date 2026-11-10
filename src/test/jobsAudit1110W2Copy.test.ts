/**
 * Whole-app audit 11-10 (Worker 2, Jobs): in-app copy fixes, one block per finding, read from the component
 * source with comments blanked so a comment quoting the old words cannot keep a test green.
 *
 * F294: the Apply sheet's checkbox said "Save as my default pitch" — "pitch" is sales jargon a first-time Helpr
 * does not use. It now says "Use this message next time" (the row already wraps the control in a 44px label).
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | Use this message next time | Save as my default pitch
 *
 * F284a: the Browse filter's price caption said "The job's price as posted" while the cards show the Helpr's pay
 * after the fee (helprTakeHome.tsx), so the two numbers looked like a contradiction. The slider still filters on the
 * posted price (min_budget / max_budget are the posted figure), so the caption says so AND names the card's number.
 * @mutate src/components/dashboard/filterSheet/PayRangeSlider.tsx | The price the poster set. Cards show your pay after the Helpr fee. | The job's price as posted
 *
 * F295: the blocked-message sheet labelled a caught phrase "Off-platform language detected" and promised that
 * "no strike has been recorded" — moderation words that scare a well-meaning Helpr. The scanner now labels the two
 * catches in plain words ("Asking to pay outside Helpr", "Asking to call") and the callout drops "strike".
 * @mutate src/lib/messageScanner.ts | label: "Asking to pay outside Helpr" | label: "Off-platform language detected"
 * @mutate src/lib/messageScanner.ts | label: "Asking to call" | label: "Off-platform language detected"
 * @mutate src/components/richMessageInput/ViolationDialog.tsx | Nothing was sent and nothing counts against you | Nothing has been sent
          and no strike has been recorded
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("audit 11-10 W2: Jobs in-app copy", () => {
  it("F294: the Apply sheet offers to reuse the message in plain words, not 'pitch'", () => {
    const src = read("src/components/dashboard/applyConfirmDialog/ApplyBody.tsx");
    expect(src).toContain("Use this message next time");
    expect(src).not.toMatch(/(your|saved|default) pitch/i);
  });

  it("F284a: the price filter caption names both numbers (posted price vs the card's pay)", () => {
    const src = read("src/components/dashboard/filterSheet/PayRangeSlider.tsx");
    expect(src).toContain("The price the poster set. Cards show your pay after the Helpr fee.");
    expect(src).not.toContain("price as posted");
  });

  it("F295: blocked-message labels and callout use plain words, no 'language detected' or 'strike'", () => {
    const scanner = read("src/lib/messageScanner.ts");
    expect(scanner).toContain('label: "Asking to pay outside Helpr"');
    expect(scanner).toContain('label: "Asking to call"');
    expect(scanner).not.toContain("Off-platform language detected");
    const dialog = read("src/components/richMessageInput/ViolationDialog.tsx");
    expect(dialog).toContain("Nothing was sent and nothing counts against you");
    expect(dialog).not.toMatch(/strike/i);
  });
});
