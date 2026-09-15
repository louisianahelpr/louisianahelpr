/**
 * VN-15 (owner, 2026-09-15): the public profile shows ONE review list. Expanding
 * reviews used to mount PublicReviewWall AND ReviewsSection, printing the same
 * quotes twice in two card styles.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../UserProfile.tsx"), "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("public profile review surface (VN-15)", () => {
  it("renders a single review list, not the wall plus the list", () => {
    expect(src).not.toMatch(/<PublicReviewWall\b/);
    expect(src.match(/<ReviewsSection\b/g)?.length).toBe(1);
  });
});
