/**
 * "BIGGER TEXT AND BUTTONS" IS DESCRIBED ONE WAY WHEREVER ITS SWITCH IS (Q2657).
 *
 * Account audit 1102d row 17 (~/.lh-shots/audit-1102d-findings.md, h-settings-375.png, h-accessibility-375.png):
 * Settings > Look said "Easier reading everywhere"; its Color mode row opens Accessibility, which said "Larger text
 * and bigger tap targets" for the same switch. Inventory: every profile file that draws the setting's switch (reads
 * onToggleSeniorMode in JSX) must show BIGGER_TEXT_LABEL and BIGGER_TEXT_SUB, and no file keeps its own words.
 */
// @mutate src/components/profile/SettingsTab.tsx |             sub={BIGGER_TEXT_SUB} |             sub="Easier reading everywhere"
// @mutate src/components/profile/AccessibilityTab.tsx | <p className="text-ds-11 text-muted-foreground mt-0.5">{BIGGER_TEXT_SUB}</p> | <p className="text-ds-11 text-muted-foreground mt-0.5">Larger text and bigger tap targets</p>
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { BIGGER_TEXT_SUB } from "./biggerTextWords";

const DIR = resolve(__dirname);
const drawers = readdirSync(DIR)
  .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ f, src: blankComments(readFileSync(resolve(DIR, f), "utf8")) }))
  .filter(({ src }) => /onCheckedChange=\{onToggleSeniorMode\}|onToggleSeniorMode\(!seniorMode\)/.test(src));

describe("Bigger text and buttons: one description (Q2657)", () => {
  it("finds both places that draw the switch (inventory floor)", () => {
    expect(drawers.map((d) => d.f).sort()).toEqual(["AccessibilityTab.tsx", "SettingsTab.tsx"]);
    expect(drawers.length).toBeGreaterThan(1);
  });
  it.each(drawers.map((d) => [d.f, d.src] as const))("%s shows the shared label and description, and no words of its own", (_f, src) => {
    expect(src).toMatch(/\{BIGGER_TEXT_SUB\}/);
    expect(src).toMatch(/\{BIGGER_TEXT_LABEL\}/);
    expect(src).not.toMatch(/Easier reading everywhere|Larger text and bigger tap targets/);
    expect(src).not.toMatch(/>\s*Bigger text and buttons\s*</);
  });
  it("the description names what it changes", () => {
    expect(BIGGER_TEXT_SUB).toMatch(/text/i);
  });
});
