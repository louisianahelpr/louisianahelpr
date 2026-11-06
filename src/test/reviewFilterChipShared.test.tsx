/**
 * Q2709 "nothing hand-made" (public profile packet, Builder 2, 2026-11-06; lead: convert ONLY what stays
 * look-identical). The Reviews category chips and star buckets on a member's profile (pages/user/ReviewsSection.tsx)
 * were hand-made <button aria-pressed>s with one class set and one inline fill; they are the shared ReviewFilterChip
 * now. Look-identical by construction: the class SET equals the hand-made literal (star buckets add tabular-nums, as
 * before), the inline colour/fill/edge are the same per state, aria-pressed is kept.
 *
 * @mutate src/components/ui/ReviewFilterChip.tsx |         background: pressed ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)", |         background: "hsl(var(--bark) / 0.08)",
 * @mutate src/components/ui/ReviewFilterChip.tsx | gap-1 px-2 py-1 rounded-ds-md | gap-1 px-2.5 py-1 rounded-ds-md
 * @mutate src/components/ui/ReviewFilterChip.tsx |       aria-pressed={pressed}\n |       \n
 * @mutate src/pages/user/ReviewsSection.tsx |                   className="tabular-nums"\n |                   \n
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ReviewFilterChip } from "@/components/ui/ReviewFilterChip";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE = "inline-flex items-center gap-1 px-2 py-1 rounded-ds-md text-ds-11 font-sans font-semibold transition-colors";
const styleOf = (s: Record<string, string>) => { const d = document.createElement("div"); Object.assign(d.style, s); return d.getAttribute("style"); };

describe("public profile Reviews chips are the shared ReviewFilterChip, class for class", () => {
  it("renders the hand-made set and each state's inline fill, with aria-pressed", () => {
    for (const pressed of [true, false]) {
      const b = render(<ReviewFilterChip pressed={pressed}>x</ReviewFilterChip>).container.querySelector("button")!;
      expect(set(b.className)).toEqual(set(HAND_MADE));
      expect(b.getAttribute("aria-pressed")).toBe(String(pressed));
      expect(b.getAttribute("style")).toBe(styleOf(pressed
        ? { color: "hsl(var(--parchment))", background: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.6)" }
        : { color: "hsl(var(--bark))", background: "hsl(var(--bark) / 0.08)", border: "0.5px solid hsl(var(--bark) / 0.18)" }));
    }
    const star = render(<ReviewFilterChip pressed={false} className="tabular-nums">5</ReviewFilterChip>).container.querySelector("button")!;
    expect(set(star.className)).toEqual(set(`${HAND_MADE} tabular-nums`));
  });

  it("ReviewsSection uses it for both rows and keeps no hand-made copy", () => {
    const s = readFileSync("src/pages/user/ReviewsSection.tsx", "utf8");
    expect(s).not.toContain("gap-1 px-2 py-1 rounded-ds-md text-ds-11 font-sans font-semibold");
    // Inventory floor: the category row and the star-bucket row (measured 2026-11-06).
    expect((s.match(/<ReviewFilterChip\b/g) ?? []).length).toBeGreaterThan(1);
    expect(s).toMatch(/<ReviewFilterChip\s+pressed=\{active\}\s+key=\{bucket\.key\}[\s\S]*?className="tabular-nums"/);
  });
});
