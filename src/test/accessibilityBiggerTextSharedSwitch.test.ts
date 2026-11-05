/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): Profile -> Accessibility's "Bigger text and
 * buttons" row toggles through the shared Switch (src/components/ui/switch: the 44px hit area, haptic, shared track
 * colours), the same control Settings draws for the same setting, never a hand-made role="switch" with its own
 * drawn thumb. The whole row still toggles: it is the Switch's <label htmlFor>. The hand-made ratchet lost the
 * file's entry and the hover ledger its adhoc tint in the same commit.
 *
 * @mutate src/components/profile/AccessibilityTab.tsx | <Switch id="a11y-bigger-text" checked={seniorMode} | <Switch id="a11y-bigger-text-off" checked={seniorMode}
 * @mutate src/components/profile/AccessibilityTab.tsx |             htmlFor="a11y-bigger-text" |             data-for="a11y-bigger-text"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/profile/AccessibilityTab.tsx"), "utf8"));

describe("Accessibility's Bigger text row is the shared Switch (Q2709)", () => {
  it("draws the shared Switch, named, and the whole row is its label", () => {
    const sw = src.match(/<Switch\b[^>]*\/>/g) ?? [];
    expect(sw.length).toBe(1);
    expect(sw[0]).toMatch(/checked=\{seniorMode\}/);
    expect(sw[0]).toMatch(/onCheckedChange=\{onToggleSeniorMode\}/);
    expect(sw[0]).toMatch(/aria-label=\{BIGGER_TEXT_LABEL\}/);
    const id = /\bid="([\w-]+)"/.exec(sw[0] ?? "")?.[1];
    expect(id, "the Switch has no id for the row label").toBeTruthy();
    expect(src).toContain(`htmlFor="${id ?? "(none)"}"`);
    expect(src).not.toMatch(/role="switch"/);
    expect(src).not.toMatch(/<button\b/);
  });
});
