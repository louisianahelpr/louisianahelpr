/**
 * Audit #34 (2026-10-21): one setting, one name. Settings' "Bigger text and
 * buttons" switch and the Accessibility tab's row are the same flag
 * (senior_mode); both now say "Bigger text and buttons".
 *
 * Q2657 (2026-11-02): both now read the name (and one description) from
 * src/components/profile/biggerTextWords.ts.
 *
 * @mutate src/components/profile/biggerTextWords.ts | export const BIGGER_TEXT_LABEL = "Bigger text and buttons"; | export const BIGGER_TEXT_LABEL = "Senior mode";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { BIGGER_TEXT_LABEL } from "@/components/profile/biggerTextWords";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("bigger text has one name", () => {
  it("the Accessibility switch says Bigger text and buttons (the one switch since polish 11-27 #134)", () => {
    expect(BIGGER_TEXT_LABEL).toBe("Bigger text and buttons");
    const a = read("src/components/profile/AccessibilityTab.tsx");
    expect(a).toContain(">{BIGGER_TEXT_LABEL}</p>");
    expect(a).not.toMatch(/>Senior mode</);
    expect(read("src/components/profile/profileLanding/workMenuGroup.tsx")).not.toMatch(/Senior mode/);
  });
});
