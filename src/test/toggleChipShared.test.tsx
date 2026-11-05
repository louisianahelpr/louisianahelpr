/**
 * CLASS GUARD (Q2709, 11-04; owner 10-31 "Nothing hand-made"): a multi-select on/off chip is the shared ToggleChip
 * (src/components/ui/ToggleChip.tsx), never a hand-written <button aria-pressed>.
 *   1. ToggleChip is a toggle button: aria-pressed, NO role="radio" (ChoicePill is the one-of-many pill; a filter
 *      row where several chips are on at once is not a radiogroup).
 *   2. One look, from ChoicePill's tokens: 44px floor, the shared glossy primary when on (ink declared inline), the
 *      firm unselected edge on the page fill (lead 2026-10-28: card-on-card vanished in dark).
 *   3. RATCHET: every hand-written <button aria-pressed> outside src/components/ui is counted per file from the
 *      TypeScript AST (comments and strings cannot hide or invent one) and pinned in
 *      docs/audit/hand-made-toggle-chips-baseline.json, exact both ways. Measured 11-04 9:40 PM: 58 in 41 files
 *      after Declutter's filter sheet and Buying/Selling status chips moved onto ToggleChip (61 before); 57 in 40
 *      after the Declutter review sheet's quick tags (11-04 10:25 PM).
 *   4. WRAP: a phrase chip (the review sheet's tags) may take a second line inside its row; a filter chip keeps one.
 *
 * @mutate src/components/ui/ToggleChip.tsx | aria-pressed={pressed} | role="radio" aria-checked={pressed}
 * @mutate src/components/ui/ToggleChip.tsx | pressed ? "btn-grad-primary !text-[hsl(var(--parchment))]" | pressed ? "bg-primary/20"
 * @mutate src/components/ui/ToggleChip.tsx | wrap ? "max-w-full justify-center whitespace-normal py-2 text-center leading-tight [overflow-wrap:anywhere]" : "shrink-0 whitespace-nowrap", | "shrink-0 whitespace-nowrap",
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | <ToggleChip key={tag} pressed={on} wrap onClick= | <ToggleChip key={tag} pressed={on} onClick=
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx | <ToggleChip pressed={on} onClick={onClick}> | <button type="button" aria-pressed={on} onClick={onClick}>
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";
import { ToggleChip } from "@/components/ui/ToggleChip";
import BASELINE from "../../docs/audit/hand-made-toggle-chips-baseline.json";

const REPO = resolve(__dirname, "..", "..");

function countPressedButtons(source: string, file = "x.tsx"): number {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === "button") {
      if (node.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "aria-pressed")) n += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

function measure(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of trackedFiles("src")) {
    if (!f.endsWith(".tsx") || f.startsWith("src/components/ui/") || f.startsWith("src/test/") || /\.test\.tsx$/.test(f)) continue;
    const n = countPressedButtons(readFileSync(resolve(REPO, f), "utf8"), f);
    if (n) out[f] = n;
  }
  return out;
}

describe("ToggleChip is the one on/off chip (Q2709)", () => {
  it("is a toggle button: aria-pressed, never role=radio", () => {
    render(
      <>
        <ToggleChip pressed onClick={() => {}}>On</ToggleChip>
        <ToggleChip pressed={false} onClick={() => {}}>Off</ToggleChip>
      </>,
    );
    const on = screen.getByRole("button", { name: "On" });
    const off = screen.getByRole("button", { name: "Off" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(on.hasAttribute("role")).toBe(false);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("wears ChoicePill's look: 44px floor, the shared primary when on, the firm edge when off", () => {
    render(
      <>
        <ToggleChip pressed>On</ToggleChip>
        <ToggleChip pressed={false}>Off</ToggleChip>
      </>,
    );
    const on = screen.getByRole("button", { name: "On" }).className.split(/\s+/);
    const off = screen.getByRole("button", { name: "Off" }).className.split(/\s+/);
    for (const cls of [on, off]) {
      expect(cls).toContain("min-h-11");
      expect(cls).toContain("rounded-full");
      expect(cls).toContain("ring-offset-background");
    }
    expect(on).toContain("btn-grad-primary");
    expect(off).not.toContain("btn-grad-primary");
    expect(off).toContain("bg-background");
    expect(off).not.toContain("bg-card");
  });

  it("wrap lets a phrase chip take a second line inside its row; without it a chip keeps one line", () => {
    render(
      <>
        <ToggleChip pressed={false} wrap>Showed up on time</ToggleChip>
        <ToggleChip pressed={false}>Filter</ToggleChip>
      </>,
    );
    const wrapped = screen.getByRole("button", { name: "Showed up on time" }).className.split(/\s+/);
    const one = screen.getByRole("button", { name: "Filter" }).className.split(/\s+/);
    expect(wrapped).toContain("whitespace-normal");
    expect(wrapped).toContain("max-w-full");
    expect(wrapped).not.toContain("whitespace-nowrap");
    expect(wrapped).not.toContain("shrink-0");
    expect(wrapped).toContain("min-h-11");
    expect(one).toContain("whitespace-nowrap");
    expect(one).not.toContain("whitespace-normal");
  });

  it("the Declutter review sheet's quick tags are wrapping ToggleChips (Q2709)", () => {
    const src = readFileSync(resolve(REPO, "src/components/declutter/DeclutterReviewForm.tsx"), "utf8");
    const sf = ts.createSourceFile("r.tsx", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const chips: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === "ToggleChip") chips.push(node.getText(sf));
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c, c).toMatch(/\swrap[\s>]/);
    expect(countPressedButtons(src)).toBe(0);
  });

  it("the AST counter sees <button aria-pressed>, not comments or strings (can fail)", () => {
    const src = `// <button aria-pressed>\nconst s = "<button aria-pressed={x}>";\nexport const A = () => <div><button type="button" aria-pressed={true}>x</button><button type="button">y</button></div>;`;
    expect(countPressedButtons(src)).toBe(1);
  });

  it("hand-written <button aria-pressed> per file equals the baseline (exact, both ways)", () => {
    const now = measure();
    expect(Object.keys(now).length).toBeGreaterThan(38);
    const base = BASELINE.files as Record<string, number>;
    const diffs: string[] = [];
    for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
      const a = now[f] ?? 0;
      const b = base[f] ?? 0;
      if (a > b) diffs.push(`${f}: ${a - b} new hand-written <button aria-pressed> (use ToggleChip from src/components/ui)`);
      if (a < b) diffs.push(`${f}: fell ${b} -> ${a}: lower docs/audit/hand-made-toggle-chips-baseline.json in this commit`);
    }
    expect(diffs).toEqual([]);
  });
});
