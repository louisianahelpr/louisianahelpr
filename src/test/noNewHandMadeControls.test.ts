/**
 * CLASS GUARD (OWN-SHARED, owner 10-31: "Nothing hand-made"): every button,
 * text box, dropdown and pop-up uses the shared components in
 * src/components/ui (Button, Input, Textarea, Select, Dialog/Sheet). This is
 * the guard that lands FIRST: it freezes today's hand-made count so no new
 * one is added, and every conversion lowers it (exact, both ways: a lower
 * count fails until the baseline below is lowered in the same commit).
 *
 * Read from the TypeScript AST, so a comment or a string cannot invent or
 * hide a hit: JSX intrinsic elements <button>, <input>, <textarea>, <select>
 * and <dialog>, in every tracked .tsx under src/ except the shared
 * components themselves (src/components/ui) and tests. Each file's count is
 * pinned, so moving a hand-made control into a new file is caught too.
 *
 * Measured 2026-10-31 19:03 CT on wip/b3-1031 (b38): 563 buttons, 147 text boxes,
 * 20 textareas, 26 dropdowns, 0 dialogs in 347 files. Spinners and cards are
 * not read here yet (the sweep decides their shared forms first).
 *
 * @mutate src/pages/user/JobsList.tsx | <span className="text-ds-10 font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Expired</span> | <button type="button">Expired</button>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";
import BASELINE from "../../docs/audit/hand-made-controls-baseline.json";

const REPO = resolve(__dirname, "..", "..");
const KINDS = ["button", "input", "textarea", "select", "dialog"] as const;
type Kind = (typeof KINDS)[number];

function countHandMade(source: string, file = "x.tsx"): Record<Kind, number> {
  const out: Record<Kind, number> = { button: 0, input: 0, textarea: 0, select: 0, dialog: 0 };
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if ((KINDS as readonly string[]).includes(tag)) out[tag as Kind] += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function measure(): Record<string, Partial<Record<Kind, number>>> {
  const perFile: Record<string, Partial<Record<Kind, number>>> = {};
  for (const f of trackedFiles("src")) {
    if (!f.endsWith(".tsx") || f.startsWith("src/components/ui/") || /\.test\.tsx$/.test(f) || f.startsWith("src/test/")) continue;
    const c = countHandMade(readFileSync(resolve(REPO, f), "utf8"), f);
    const nonZero = Object.fromEntries(Object.entries(c).filter(([, v]) => v > 0));
    if (Object.keys(nonZero).length) perFile[f] = nonZero;
  }
  return perFile;
}

describe("no new hand-made controls (OWN-SHARED)", () => {
  it("the AST counter sees JSX controls, not comments or strings (can fail)", () => {
    const c = countHandMade(`// <button>\nconst s = "<input>";\nexport const A = () => <div><button type="button">x</button><input /><select></select></div>;`);
    expect(c).toEqual({ button: 1, input: 1, textarea: 0, select: 1, dialog: 0 });
  });

  it("every file's hand-made count equals the baseline (exact, both ways)", () => {
    const now = measure();
    const files = Object.keys(now);
    expect(files.length).toBeGreaterThan(100);
    const diffs: string[] = [];
    const base = BASELINE.files as Record<string, Partial<Record<Kind, number>>>;
    for (const f of new Set([...files, ...Object.keys(base)])) {
      for (const k of KINDS) {
        const a = now[f]?.[k] ?? 0;
        const b = base[f]?.[k] ?? 0;
        if (a > b) diffs.push(`${f}: ${a - b} new hand-made <${k}> (use the shared component in src/components/ui)`);
        if (a < b) diffs.push(`${f}: <${k}> fell ${b} -> ${a}: lower docs/audit/hand-made-controls-baseline.json in this commit`); // stale entry
      }
    }
    expect(diffs).toEqual([]);
  });
});
