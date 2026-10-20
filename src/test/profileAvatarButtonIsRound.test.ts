/**
 * Q981: no square behind the round profile photo. The You card (board 18,
 * YouCard, which replaced IdentityHeader on 2026-10-20) wraps its photo in a
 * ROUND button, and Edit profile's photo is round too (board 41): a
 * `rounded-ds-avatar squircle` box around a circular photo is what drew the
 * stray rounded square.
 *
 * @mutate src/components/profile/profileLanding/YouCard.tsx | aria-label="View my public profile" className="btn-press relative shrink-0 rounded-full" | aria-label="View my public profile" className="btn-press relative shrink-0 rounded-ds-avatar squircle"
 * @mutate src/components/profile/profileEditForm/PhotoNameSection.tsx | className="w-20 h-20 rounded-full border-2 border-primary/20" | className="w-20 h-20 rounded-ds-avatar squircle border-2 border-primary/20"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("Q981: the profile photo is round, with no square behind it", () => {
  it("the You card's photo button is round", () => {
    const src = read("components/profile/profileLanding/YouCard.tsx");
    expect(src).toMatch(/aria-label="View my public profile" className="[^"]*\brounded-full\b/);
    expect(src).not.toMatch(/rounded-ds-avatar|squircle/);
  });
  it("Edit profile's photo is round", () => {
    const src = read("components/profile/profileEditForm/PhotoNameSection.tsx");
    expect(src).toContain('className="w-20 h-20 rounded-full border-2 border-primary/20"');
  });
});
