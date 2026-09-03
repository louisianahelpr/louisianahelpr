import { describe, it, expect } from "vitest";
import { avatarGradientFor } from "./avatarGradient";

describe("avatarGradientFor", () => {
  it("is deterministic — same seed → same gradient", () => {
    const a = avatarGradientFor("user_abc123");
    const b = avatarGradientFor("user_abc123");
    expect(a).toBe(b);
  });

  it("returns a Tailwind from/to fragment", () => {
    const cls = avatarGradientFor("any-seed");
    // Both stops are OPAQUE 6-digit hex on purpose: an alpha on the `to` stop
    // composites over whatever is behind the element, not over the `from`
    // colour, which is how the dark-mode failure survived the first fix.
    expect(cls).toMatch(/^from-\[#[0-9a-f]{6}\] to-\[#[0-9a-f]{6}\]$/);
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
    const seeds = Array.from({ length: 60 }, (_, i) => `seed_${i}`);
    const offenders = [...new Set(seeds.map(avatarGradientFor))].filter((c) => c.includes("var(--"));
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
