/**
 * Audit 2026-10-29 A3-C5: the About-you counter read "18/20 min", which reads as minutes.
 * It names its unit while the bio is short of the 20 characters.
 *
 * @mutate src/components/profile/ProfileEditForm.tsx | {bio.trim().length} of 20 characters | {bio.trim().length}/20 min
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/components/profile/ProfileEditForm.tsx"), "utf8");

describe("the About-you counter names characters (A3-C5)", () => {
  it("says 'of 20 characters', never '/20 min'", () => {
    expect(src).toContain("{bio.trim().length} of 20 characters");
    expect(src).not.toMatch(/\/20 min/);
  });
});
