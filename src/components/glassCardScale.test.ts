import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Glass cards come in a NAMED set of sizes.
 *
 * A survey of the 84 hand-rolled `rounded-2xl liquid-glass p-N` cards looked at
 * first like six competing paddings. It is not — every value has a job:
 *
 *   p-5    SECTION card. The default, and the outer container on a page.
 *   p-4    NESTED card, one level inside a section. Visible in PaymentTab,
 *          where the p-4 at :136 sits inside the p-5 at :116 — flattening
 *          these two would make a child the same weight as its parent.
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
const ALLOWED = new Set(["p-5", "p-4", "p-6", "p-3", "p-3.5", "p-1.5"]);

describe("glass card padding scale", () => {
  it("every liquid-glass card uses a padding from the named set", () => {
    // ripgrep over the source, not a glob walk — this has to see every file.
    const out = execSync(
      `grep -rhoE '(rounded-2xl liquid-glass|liquid-glass rounded-2xl) p-[0-9.]+' src --include='*.tsx' || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const found = [...new Set(
      out.split("\n").map((l) => l.match(/p-[0-9.]+$/)?.[0]).filter(Boolean) as string[],
    )];
    const unknown = found.filter((p) => !ALLOWED.has(p));
    expect(
      unknown,
      `unrecognised glass-card padding(s): ${unknown.join(", ")}. ` +
        `The scale is p-5 section / p-4 nested / p-6 centred-empty / p-3 compact. ` +
        `If one of those fits, use it; if none does, add it here with the reason.`,
    ).toEqual([]);
  });

  it("the scale itself has not silently grown", () => {
    // A second guard on the guard: if someone widens ALLOWED without thinking,
    // this makes the count change visible in the diff.
    expect(ALLOWED.size, "glass-card padding tiers").toBe(6);
  });
});
