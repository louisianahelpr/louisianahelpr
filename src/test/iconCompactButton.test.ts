/**
 * The shared compact icon Button: a 40px visual circle inside a 44px tap area (lead decision 10-31, B41 handoff item
 * 5; B44). The hit area is padded, not the visual: the box stays 44 (the app's tap floor) and a 2px transparent
 * border holds the fill, and an inset ring, to the 40px padding box.
 *
 * Measured at 1440 (headless Chromium, mocked session) on Jobs Browse's toolbar: Search, Filters and the map toggle
 * render 44x44 at x 1228 / 1276 / 1324 before and after; clientWidth 40, border 2px, background-clip padding-box after.
 * Before, the map toggle was a hand-made <button> with a 14px radius beside two pills.
 *
 * Class half, from source: no Button in the Browse toolbar folder is size="icon" (56px) or hand-sizes h-/w-, and the
 * three toolbar icon files (map toggle, Filters square, Search/Filters/Saved actions) have no hand-made <button>.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { buttonVariants } from "@/components/ui/button";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/components/ui/button.tsx |         iconCompact: "h-11 w-11 border-2 border-transparent bg-clip-padding [&_svg]:size-5", |         iconCompact: "h-10 w-10 [&_svg]:size-5",
// @mutate src/components/dashboard/browseTasksToolbar/MapToggleButton.tsx |       size="iconCompact" |       size="icon"
// @mutate src/components/declutter/DeclutterPickupTimes.tsx |           <Button type="button" variant="ghost" size="iconCompact" onClick={onRemove} | <Button type="button" variant="ghost" size="icon" onClick={onRemove}
// @mutate src/pages/profile/SavedSearchesTab.tsx |                   <Button type="button" variant="ghost" size="iconCompact" onClick={() => setEditing(s)} |                   <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(s)}
// @mutate src/pages/user/ReviewsSection.tsx |                   size="iconCompact"\n                  aria-label="Report this review" |                   size="icon"\n                  aria-label="Report this review"
// @mutate src/components/dashboard/browseTasksToolbar/FiltersIconButton.tsx |       className={`relative shrink-0 btn-press | className={`relative h-10 w-10 shrink-0 btn-press

const REPO = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));

/** Every <Button> opening tag in a file, parsed (a `>` inside an attribute expression cannot cut it short). */
function buttonTags(f: string): { size: string | null; className: string }[] {
  const sf = ts.createSourceFile(f, readFileSync(resolve(REPO, f), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { size: string | null; className: string }[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === "Button") {
      let size: string | null = null;
      let className = "";
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText(sf);
        if (name === "size") size = a.initializer.getText(sf).replace(/^["'{]+|["'}]+$/g, "");
        if (name === "className") className = a.initializer.getText(sf);
      }
      out.push({ size, className });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("the compact icon Button", () => {
  it("is a 44px box whose fill sits in a 40px padding box", () => {
    const cls = buttonVariants({ variant: "ghost", size: "iconCompact" }).split(/\s+/);
    for (const c of ["h-11", "w-11", "border-2", "border-transparent", "bg-clip-padding", "rounded-full"]) expect(cls).toContain(c);
  });

  it("every icon control in the Browse toolbar is the shared Button at iconCompact", () => {
    const files = trackedFiles("src/components/dashboard/browseTasksToolbar").filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    expect(files.length).toBeGreaterThan(3);
    const named = ["MapToggleButton.tsx", "FiltersIconButton.tsx", "BrowseTasksActions.tsx"];
    for (const n of named) expect(files.some((f) => f.endsWith(`/${n}`)), n).toBe(true);
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(f);
      // The toolbar's icon squares; BrowseSearchBar's raw buttons are a text "Clear", combobox options and the in-field ✕.
      if (named.some((n) => f.endsWith(`/${n}`)) && /<button\b/.test(src)) offenders.push(`${f}: hand-made <button>`);
      for (const tag of buttonTags(f)) {
        if (tag.size === "icon") offenders.push(`${f}: size="icon" (56px) in the toolbar`);
        if (/(^|[\s`"'])(?:[a-z-]+:)*!?(?:min-)?[hw]-(?:\d|\[)/.test(tag.className)) offenders.push(`${f}: hand-set h-/w- on a Button`);
      }
    }
    expect(offenders).toEqual([]);
    const compact = files.flatMap((f) => buttonTags(f).filter((t) => t.size === "iconCompact")).length;
    expect(compact).toBeGreaterThan(3);
  });

  // B47 10-31: the pickup-time window's remove X (Declutter sell / settings) was a hand-made rounded-full <button>.
  // Measured at 375 and 1440 on /declutter/sell (mocked session): 44x44 box at the same x/y, same radius, colour and
  // 16px glyph before and after; the hover wash now paints at 40 (clientWidth 44 -> 40).
  // B47 10-31, same measurement on /profile?tab=saved_searches: a saved search's settings (…) button, 44x44 at the
  // same x/y before and after (307,128 at 375; 1368,124 at 1440), radius, colour and 16px glyph unchanged, wash at 40.
  it.each([
    ["src/components/declutter/DeclutterPickupTimes.tsx", /<button\b[^>]*aria-label=\{removeLabel\}/],
    ["src/pages/profile/SavedSearchesTab.tsx", /<button\b[^>]*aria-label=\{`Settings for/],
    // B47 10-31, /user/:id (mocked public review): 44x44 at 302,384 (375) / 1359,397 (1440), margins -8 unchanged.
    ["src/pages/user/ReviewsSection.tsx", /<button\b[^>]*aria-label="Report this review"/],
  ])("%s: the ghost icon is the shared Button at iconCompact", (f, handMade) => {
    const src = code(f);
    expect(src).not.toMatch(handMade);
    const tags = buttonTags(f).filter((t) => t.size === "iconCompact");
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(/(^|[\s`"'])(?:[a-z-]+:)*!?(?:min-)?[hw]-(?:\d|\[)/.test(t.className)).toBe(false);
  });
});
