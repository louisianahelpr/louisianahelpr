import { describe, it, expect } from "vitest";
import { avatarGradientFor } from "./avatarGradient";

describe("avatarGradientFor", () => {
  it("is deterministic — same seed → same gradient", () => {
    // Across MANY seeds, not one. There are only 8 variants, so a hash that had
    // gone non-deterministic still returns the same class for a single seed one
    // time in eight — proven 2026-09-21, when a mutation adding
    // `Math.floor(Math.random() * 7)` to the djb2 accumulator SURVIVED the
    // one-seed version of this test. A user's avatar changing colour between
    // mounts is the defect; it has to be impossible to miss, not 87% likely to
    // be caught.
    const seeds = Array.from({ length: 200 }, (_, i) => `user_${i}_${i * 17}`);
    const first = seeds.map(avatarGradientFor);
    const second = seeds.map(avatarGradientFor);
    const third = seeds.map(avatarGradientFor);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  /**
   * The whole palette, derived rather than transcribed: hash enough seeds that
   * every variant comes back, so the assertions below cannot silently stop
   * covering one. A hand-listed copy of the eight strings would be the other
   * hollow shape — an inventory that goes stale with the thing it mirrors.
   */
  const ALL_VARIANTS = [...new Set(Array.from({ length: 800 }, (_, i) => avatarGradientFor(`seed_${i}`)))];

  it("hashes across the entire palette, so the checks below see every variant", () => {
    // The module ships 8. If a variant is added, this floor is what forces the
    // new one through the opaque-hex and no-token checks too.
    expect(ALL_VARIANTS.length).toBe(8);
  });

  it("returns a Tailwind from/to fragment — opaque 6-digit hex on BOTH stops, in EVERY variant", () => {
    // Both stops are OPAQUE 6-digit hex on purpose: an alpha on the `to` stop
    // composites over whatever is behind the element, not over the `from`
    // colour, which is how the dark-mode failure survived the first fix.
    //
    // This used to assert on avatarGradientFor("any-seed") — ONE variant. Seven
    // of the eight could have carried an 8-digit `#rrggbbaa` and the file would
    // have stayed green; proven 2026-09-21 by putting `#ddbd8780` into variant
    // 8, which survived the guard.
    const shape = /^from-\[#[0-9a-f]{6}\] to-\[#[0-9a-f]{6}\]$/;
    const offenders = ALL_VARIANTS.filter((cls) => !shape.test(cls));
    expect(
      offenders,
      `Every gradient stop must be an opaque 6-digit hex:\n  - ${offenders.join("\n  - ")}`,
    ).toEqual([]);
  });

  /**
   * The invariant this file exists to protect, and the one that was broken.
   *
   * The palette is a CALIBRATION — a light warm base and a mid-depth accent at
   * an opacity tuned so the dark initials clear WCAG AA at the darkest point.
   * It used to be written as `hsl(var(--parchment))` / `hsl(var(--bark)/0.62)`
   * and every one of those tokens INVERTS under `[data-theme="dark"]`, so in
   * dark mode "cream → deep accent" silently became "near-black → near-white"
   * and no ink colour worked at both ends: measured across all eight variants,
   * --ink-deep bottomed out at 2.54:1, pure white at 3.54:1, the light ink at
   * 1.04:1.
   *
   * So: no theme tokens in this palette, in either stop. A future edit that
   * reaches for `var(--…)` because it looks tidier re-introduces the bug, and
   * it re-introduces it invisibly — light mode would still look right.
   */
  it("uses no theme-reactive tokens — the palette must not invert with the theme", () => {
    const offenders = ALL_VARIANTS.filter((c) => c.includes("var(--"));
    expect(
      offenders,
      "Avatar gradient stops must be literal colours. A theme token here inverts in dark mode " +
        `and takes the ink calibration with it:\n  - ${offenders.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("falls back to a stable variant for null/undefined/empty", () => {
    const empty = avatarGradientFor("");
    expect(avatarGradientFor(null)).toBe(empty);
    expect(avatarGradientFor(undefined)).toBe(empty);
  });

  it("distributes across multiple variants for varied seeds", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `user_${i}_${i * 17}`);
    const unique = new Set(seeds.map(avatarGradientFor));
    // We don't assert "all variants hit" (luck) but >2 means hashing actually
    // spreads — a constant-output bug would collapse this to 1.
    expect(unique.size).toBeGreaterThan(2);
  });
});

// The exact regression, re-introduced: a stop written as a theme token. It
// looks tidier, light mode still looks correct, and dark mode silently inverts
// "cream → deep accent" into "near-black → near-white", which no ink colour
// clears AA against (measured floor 2.54:1 across the eight variants).
// @mutate src/lib/avatarGradient.ts | "from-[#f0f2f4] to-[#979a86]", | "from-[hsl(var(--parchment))] to-[hsl(var(--bark)/0.62)]",
// The second half of the same bug: a semi-transparent `to` stop composites over
// the element's BACKDROP, not over the `from` colour, so the calibration is
// only valid while both stops are opaque 6-digit hex.
// @mutate src/lib/avatarGradient.ts | "from-[#ffffff] to-[#ddbd87]", | "from-[#ffffff] to-[#ddbd8780]",
// Determinism: the same user must not flash between gradients across mounts.
// @mutate src/lib/avatarGradient.ts | h = ((h << 5) + h + s.charCodeAt(i)) \| 0; | h = ((h << 5) + h + s.charCodeAt(i) + Math.floor(Math.random() * 7)) \| 0;
