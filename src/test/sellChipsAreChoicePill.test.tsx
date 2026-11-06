/**
 * Q2709 (owner pop-up answer 2026-11-06 7 AM: "switch"): the Declutter Sell step chips (ChipGroup in
 * DeclutterSellSteps.tsx: category, condition, the price-drop percentages, ...) are the app's shared ChoicePill, never
 * a hand-made <button role="radio"> copy. What the owner chose, measured in jsdom on the rendered chips:
 *   1. every chip is a ChoicePill: 44 px floor (min-h-11, was min-h-10), the shared focus ring, the glossy primary
 *      surface when selected (ink declared inline), the card fill + border when not;
 *   2. a compact row keeps its tighter 12 px sides (Q2571: five percentages fit one 375 row), the others 16 px;
 *   3. it stays a radiogroup of radios, and pressing a chip chooses it;
 *   4. DeclutterSellSteps.tsx draws no <button> of its own for a chip (hand-made-controls-baseline.json has no entry).
 * Before/after shots (375/1440, light + dark, hover): ~/.lh-shots/b2-q2709-decisions/sellchips-*.png.
 *
 * @mutate src/components/declutter/DeclutterSellSteps.tsx |     <ChoicePill key={o.value} selected={value === o.value} |     <ChoicePill key={o.value} selected={false}
 * @mutate src/components/declutter/DeclutterSellSteps.tsx | className={compact ? "px-3" : undefined}> | className={undefined}>
 * @mutate src/components/declutter/DeclutterSellSteps.tsx |     <ChoicePill key={o.value} selected={value === o.value} onClick={() => onChange(o.value)} |     <ChoicePill key={o.value} selected={value === o.value} onClick={() => undefined}
 * @mutate src/components/ui/ChoicePill.tsx | "flex min-h-11 items-center rounded-full px-4 | "flex min-h-10 items-center rounded-full px-4
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ChipGroup } from "@/components/declutter/DeclutterSellSteps";
import { ChoicePill } from "@/components/ui/ChoicePill";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const OPTIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
];

function Harness({ compact = false, onPick = vi.fn() }: { compact?: boolean; onPick?: (v: string) => void }) {
  const [v, setV] = useState("like_new");
  return <ChipGroup label="Condition" options={OPTIONS} value={v} compact={compact} onChange={(n) => { setV(n); onPick(n); }} />;
}
const pillClass = (selected: boolean, className?: string) =>
  render(<ChoicePill selected={selected} className={className}>x</ChoicePill>).container.querySelector("button")!.className;

describe("the Sell step chips are the shared ChoicePill (owner 11-06: switch)", () => {
  it("every chip renders ChoicePill's class set: 44 px, focus ring, glossy when chosen", () => {
    const want = { on: set(pillClass(true)), off: set(pillClass(false)) };
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Condition" });
    const chips = within(group).getAllByRole("radio");
    // Inventory floor: the three options rendered.
    expect(chips.length).toBeGreaterThan(2);
    for (const c of chips) {
      const on = c.getAttribute("aria-checked") === "true";
      expect(set(c.className), c.textContent ?? "").toEqual(on ? want.on : want.off);
      expect(c.className).toMatch(/\bmin-h-11\b/);
      expect(c.className).toMatch(/\bfocus-visible:ring-2\b/);
    }
    const chosen = chips.filter((c) => c.getAttribute("aria-checked") === "true");
    expect(chosen.map((c) => c.textContent)).toEqual(["Like new"]);
    expect(chosen[0].className).toMatch(/\bbtn-grad-primary\b/);
  });

  it("a compact row keeps 12 px sides; a normal row 16 px", () => {
    const { unmount } = render(<Harness compact />);
    for (const c of screen.getAllByRole("radio")) {
      expect(c.className).toMatch(/\bpx-3\b/);
      expect(c.className).not.toMatch(/\bpx-4\b/);
      expect(c.hasAttribute("data-chip-compact")).toBe(true);
    }
    unmount();
    render(<Harness />);
    for (const c of screen.getAllByRole("radio")) expect(c.className).toMatch(/\bpx-4\b/);
  });

  it("pressing a chip chooses it", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("radio", { name: "Good" }));
    expect(onPick).toHaveBeenCalledWith("good");
    expect(screen.getByRole("radio", { name: "Good" }).getAttribute("aria-checked")).toBe("true");
  });

  it("DeclutterSellSteps.tsx draws no chip of its own", () => {
    const src = readFileSync("src/components/declutter/DeclutterSellSteps.tsx", "utf8");
    expect(src).toContain("<ChoicePill");
    expect(src).not.toMatch(/<button[^>]*role="radio"/);
    const baseline = JSON.parse(readFileSync("docs/audit/hand-made-controls-baseline.json", "utf8")) as { files: Record<string, unknown> };
    expect(baseline.files["src/components/declutter/DeclutterSellSteps.tsx"]).toBeUndefined();
  });
});
