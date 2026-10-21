/**
 * Audit #34 (2026-10-21): one setting, one name. Settings' "Bigger text and
 * buttons" switch and the Accessibility tab's row are the same flag
 * (senior_mode); both now say "Bigger text and buttons".
 *
 * @mutate src/components/profile/AccessibilityTab.tsx | leading-tight">Bigger text and buttons</p> | leading-tight">Senior mode</p>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("bigger text has one name", () => {
  it("Settings and Accessibility both say Bigger text and buttons", () => {
    expect(read("src/components/profile/SettingsTab.tsx")).toContain('label="Bigger text and buttons"');
    const a = read("src/components/profile/AccessibilityTab.tsx");
    expect(a).toContain(">Bigger text and buttons</p>");
    expect(a).not.toMatch(/>Senior mode</);
    expect(read("src/components/profile/profileLanding/workMenuGroup.tsx")).not.toMatch(/Senior mode/);
  });
});
