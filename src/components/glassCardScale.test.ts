import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Glass cards come in a NAMED set of sizes.
 *
 * A survey of the 84 hand-rolled `rounded-2xl liquid-glass p-N` cards looked at
 * first like six competing paddings. It is not — every value has a job:
 *
 *   p-card THE card: 16px on a phone, 20px from `sm` (--card-pad, Q213b,
 *          owner 2026-09-26). It replaced the old p-5 section / p-4 nested
 *          pair, which the owner collapsed into one responsive token;
 *          src/test/cardPaddingToken.test.ts keeps raw p-4/p-5 out.
 *   p-6    CENTRED EMPTY STATE. Wants more air because the content is one
 *          short line in the middle of an otherwise empty box.
 *   p-3    COMPACT row inside a nested card — a third level down.
 *   p-3.5  StarRow's rating row.
 *   p-1.5  A segmented-control track, not a card in the usual sense.
 *
 * So the system is real and the drift risk is a SEVENTH value appearing
 * because nobody knew the other six were deliberate. This test is that
 * knowledge, written down and enforced: add a new padding and it fails, which
 * is the moment to ask whether the tier already exists.
 *
 * Deliberately NOT a component refactor. Routing 84 call sites through a
 * `<GlassCard tier=…>` would be a very large diff for zero visual change, and
 * the risk of one site rendering differently afterwards is larger than the
 * problem it solves.
 */
const ALLOWED = new Set(["p-card", "p-6", "p-3", "p-3.5", "p-1.5"]);

describe("glass card padding scale", () => {
  it("every liquid-glass card uses a padding from the named set", () => {
    // ripgrep over the source, not a glob walk — this has to see every file.
    const out = execSync(
      `grep -rhoE '(rounded-2xl liquid-glass|liquid-glass rounded-2xl) p-(card|[0-9.]+)' src --include='*.tsx' || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const matches = out.split("\n").map((l) => l.match(/p-(card|[0-9.]+)$/)?.[0]).filter(Boolean) as string[];

    /*
     * INVENTORY FLOOR — the difference between this guard checking 73 cards
     * and checking nothing.
     *
     * Everything below is per-member: with an empty `matches` there is no
     * unknown padding, `unknown` is `[]`, and the test passes while covering
     * zero call sites. That is not hypothetical here — the inventory is a
     * grep for two literal class ORDERINGS of `rounded-2xl liquid-glass`.
     * Rename the material, reorder the pair, or move the padding ahead of
     * them, and the whole survey silently returns nothing.
     *
     * 73 cards on 2026-09-21. The floor is set below that so ordinary churn
     * does not trip it, but far enough above zero that a rename cannot.
     */
    expect(
      matches.length,
      "the glass-card survey found (almost) nothing — the grep no longer matches the class string it is looking for, so this guard is covering zero call sites",
    ).toBeGreaterThanOrEqual(50);

    const found = [...new Set(matches)];
    const unknown = found.filter((p) => !ALLOWED.has(p));
    expect(
      unknown,
      `unrecognised glass-card padding(s): ${unknown.join(", ")}. ` +
        `The scale is p-card card / p-6 centred-empty / p-3 compact. ` +
        `If one of those fits, use it; if none does, add it here with the reason.`,
    ).toEqual([]);
  });

  it("the scale itself has not silently grown", () => {
    // A second guard on the guard: if someone widens ALLOWED without thinking,
    // this makes the count change visible in the diff.
    expect(ALLOWED.size, "glass-card padding tiers").toBe(5);
  });
});

// A SIXTH padding tier appearing because nobody knew the other five were
// deliberate — the exact drift this guard was written for.
// @mutate src/components/ReferralSection.tsx | <div className="rounded-2xl liquid-glass p-card"> | <div className="rounded-2xl liquid-glass p-7">
