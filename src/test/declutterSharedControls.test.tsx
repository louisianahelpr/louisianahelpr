/**
 * Q2709 "nothing hand-made" (owner 10-31), Declutter's UI-audit controls (11-09): the "filter on" chip (F054), the
 * category row's two arrows and the gallery's dots (F060) were new hand-made <button>s (noNewHandMadeControls +4).
 * They are shared controls in src/components/ui now, each with exactly the class set it had, so the conversion
 * changes nothing a member sees. This pins: each control renders a real type="button" with that class set, and each
 * Declutter screen uses it (no hand-made <button> back in its place).
 *
 * @mutate src/components/declutter/DeclutterActiveFilters.tsx | <RemoveFilterChip\n | <button type="button" className="h-10"\n
 * @mutate src/components/declutter/DeclutterGallery.tsx | <PhotoDotButton key={url} current={i === at} | <button key={url} type="button" data-current={i === at}
 * @mutate src/components/declutter/DeclutterCategoryChips.tsx | <RowNudgeButton aria-label={t("decl.moreCategories")} onClick={() => nudge(1)}> | <button type="button" aria-label={t("decl.moreCategories")} onClick={() => nudge(1)}>
 * @mutate src/components/ui/PhotoDotButton.tsx | aria-current={current ? "true" : undefined} | aria-current={undefined}
 * @mutate src/components/ui/RemoveFilterChip.tsx |       <X className="h-3.5 w-3.5" aria-hidden />\n |
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { RowNudgeButton, ROW_NUDGE } from "@/components/ui/RowNudgeButton";
import { RemoveFilterChip, REMOVE_CHIP } from "@/components/ui/RemoveFilterChip";
import { PhotoDotButton, DOT_TARGET } from "@/components/ui/PhotoDotButton";

afterEach(cleanup);

const REPO = resolve(__dirname, "..", "..");
const classSet = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** JSX tags in a file, read from the TypeScript AST (a comment or string cannot invent one). */
function jsxTags(file: string): string[] {
  const src = readFileSync(resolve(REPO, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n.tagName.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("Declutter's audit controls are shared, look-identical controls", () => {
  it("the row arrow is a real button with the hand-made class set", () => {
    render(<RowNudgeButton aria-label="More categories">›</RowNudgeButton>);
    const b = screen.getByRole("button", { name: "More categories" });
    expect(b.getAttribute("type")).toBe("button");
    expect(classSet(b.className)).toEqual(classSet(ROW_NUDGE));
    expect(classSet(ROW_NUDGE).size).toBeGreaterThan(10);
  });

  it("the filter-on chip says what pressing it does, shows its words and an X", () => {
    render(<RemoveFilterChip aria-label="Remove filter: Free" data-active-filter="free">Free</RemoveFilterChip>);
    const b = screen.getByRole("button", { name: "Remove filter: Free" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.textContent).toBe("Free");
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.getAttribute("data-active-filter")).toBe("free");
    expect(classSet(b.className)).toEqual(classSet(REMOVE_CHIP));
  });

  it("the gallery dot marks the current photo for a screen reader and draws it as the bar", () => {
    render(
      <>
        <PhotoDotButton current aria-label="Show photo 1 of 2" />
        <PhotoDotButton current={false} aria-label="Show photo 2 of 2" />
      </>,
    );
    const on = screen.getByRole("button", { name: "Show photo 1 of 2" });
    const off = screen.getByRole("button", { name: "Show photo 2 of 2" });
    expect(on.getAttribute("aria-current")).toBe("true");
    expect(on.hasAttribute("data-dot-active")).toBe(true);
    expect(off.getAttribute("aria-current")).toBeNull();
    expect(off.hasAttribute("data-dot-active")).toBe(false);
    expect(on.querySelector("span")?.className).toContain("w-5");
    expect(off.querySelector("span")?.className).toContain("w-2.5");
    expect(classSet(on.className)).toEqual(classSet(DOT_TARGET));
  });

  it.each([
    ["src/components/declutter/DeclutterActiveFilters.tsx", "RemoveFilterChip", 1],
    ["src/components/declutter/DeclutterCategoryChips.tsx", "RowNudgeButton", 2],
    ["src/components/declutter/DeclutterGallery.tsx", "PhotoDotButton", 1],
  ])("%s uses %s (no hand-made button in its place)", (file, tag, n) => {
    const tags = jsxTags(file);
    expect(tags.length).toBeGreaterThan(2);
    expect(tags.filter((t) => t === tag).length).toBe(n);
  });

  it("the filter chips and the category row keep no hand-made <button> at all", () => {
    for (const f of ["src/components/declutter/DeclutterActiveFilters.tsx", "src/components/declutter/DeclutterCategoryChips.tsx"]) {
      expect(jsxTags(f).filter((t) => t === "button")).toEqual([]);
    }
  });
});
