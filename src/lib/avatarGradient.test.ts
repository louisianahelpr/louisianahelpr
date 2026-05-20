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
    expect(cls).toMatch(/^from-\[hsl\(var\(--[a-z-]+\)\)\] to-\[hsl\(var\(--[a-z-]+\)/);
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
