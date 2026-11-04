/**
 * Q2709 (lead 11-04): every dropdown outside src/components/ui is the shared NativeSelect: a real <select> (the
 * phone's own picker, never a popover) wearing the shared field look (FIELD_SURFACE_CLS, 48 px, one chevron), and
 * every use carries an accessible label (aria-label, an id a <label htmlFor> names, or a wrapping <label>/<Field>).
 * The hand-made count itself is pinned by noNewHandMadeControls (selects 29 -> 0 on 11-04).
 *
 * @mutate src/components/ui/select.tsx |         "flex h-12 w-full min-w-0 appearance-none text-foreground", |         "flex h-10 w-full min-w-0 text-foreground",
 * @mutate src/components/ui/select.tsx |         FIELD_SURFACE_CLS,\n        "pr-9 | "rounded-md border px-3 pr-9
 * @mutate src/components/rentals/RentPanel.tsx | <NativeSelect aria-label="How often" | <NativeSelect
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { render, screen } from "@testing-library/react";
import { NativeSelect } from "@/components/ui/select";
import { FIELD_SURFACE_CLS } from "@/components/ui/fieldSurface";
import { trackedFiles } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");

describe("Q2709 the shared native dropdown", () => {
  it("is a real <select>, 48 px, the shared field look, one hidden chevron, named by its label", () => {
    render(
      <NativeSelect aria-label="Bedrooms" defaultValue="2">
        <option value="1">1</option>
        <option value="2">2</option>
      </NativeSelect>,
    );
    const sel = screen.getByRole("combobox", { name: "Bedrooms" }) as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("2");
    const cls = sel.className.split(/\s+/);
    for (const c of ["h-12", "w-full", "appearance-none", "rounded-2xl", "glass-field", "pr-9"]) expect(cls).toContain(c);
    for (const c of FIELD_SURFACE_CLS.split(/\s+/).filter((c) => c && !/^px-/.test(c))) expect(cls).toContain(c);
    const chevron = sel.parentElement!.querySelector("svg")!;
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(sel.parentElement!.tagName).toBe("SPAN"); // allowed inside a <label>
  });

  it("every <NativeSelect> in the app has an accessible label", () => {
    const uses: string[] = [];
    const unlabeled: string[] = [];
    for (const f of trackedFiles("src")) {
      if (!f.endsWith(".tsx") || f.startsWith("src/components/ui/") || /\.test\.tsx$/.test(f) || f.startsWith("src/test/")) continue;
      const text = readFileSync(resolve(REPO, f), "utf8");
      if (!text.includes("NativeSelect")) continue;
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === "NativeSelect") {
          const where = `${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
          uses.push(where);
          const attrs = new Set(n.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf)));
          let labelled = attrs.has("aria-label") || attrs.has("aria-labelledby") || (attrs.has("id") && /htmlFor=/.test(text));
          for (let p: ts.Node | undefined = n.parent; p && !labelled; p = p.parent) {
            if (ts.isJsxElement(p) && ["label", "Field"].includes(p.openingElement.tagName.getText(sf))) labelled = true;
          }
          if (!labelled) unlabeled.push(where);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(uses.length).toBeGreaterThan(25);
    expect(unlabeled).toEqual([]);
  });
});
