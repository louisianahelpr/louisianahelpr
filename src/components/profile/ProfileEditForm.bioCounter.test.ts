/**
 * Audit 2026-10-29 A3-C5: the About-you counter read "18/20 min", which reads as minutes. Account audit 1102d row 7
 * (Q2648): "18 of 20 characters" then read like a limit almost reached, though 20 is a MINIMUM. It now says what is
 * still needed while the bio is short.
 *
 * @mutate src/components/profile/ProfileEditForm.tsx |   return `${left} more character${left === 1 ? "" : "s"} to go`; |   return `${20 - left} of 20 characters`;
 * @mutate src/components/profile/ProfileEditForm.tsx |                 {bioCharsToGo(bio)} |                 {bio.trim().length} of 20 characters
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { bioCharsToGo } from "./ProfileEditForm";

const src = readFileSync(path.join(process.cwd(), "src/components/profile/ProfileEditForm.tsx"), "utf8");

describe("the About-you counter says what is still needed (A3-C5, Q2648)", () => {
  it("counts down to the minimum, in characters", () => {
    expect(bioCharsToGo("a".repeat(18))).toBe("2 more characters to go");
    expect(bioCharsToGo("a".repeat(19))).toBe("1 more character to go");
    expect(bioCharsToGo("")).toBe("20 more characters to go");
  });

  it("the form shows it, never '/20 min' or 'of 20 characters'", () => {
    expect(src).toContain("{bioCharsToGo(bio)}");
    expect(src).not.toMatch(/\/20 min/);
    expect(src).not.toMatch(/\} of 20 characters/);
  });
});
