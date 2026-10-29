/**
 * EVERY SWITCH AND CHECKBOX HAS AN ACCESSIBLE NAME.
 *
 * Audit 2026-10-28 (part 4 half 2, F23): "post-job switches and the review checkbox may lack accessible
 * names (not checked with aria-labelledby)". This checks the whole class from source, not one screen:
 * every `<Switch>` and `<Checkbox>` element in src/ (the shared Radix controls, which render a
 * <button role="switch|checkbox"> that takes its name only from what the call site gives it) must get a
 * name one of four ways:
 *   - `aria-label` (non-empty),
 *   - `aria-labelledby` naming an id that some element in the same file carries (resolved, not trusted),
 *   - an `id` that a `<label htmlFor>` / `<Label htmlFor>` in the same file points at,
 *   - a `<label>` / `<Label>` element wrapping it.
 * A dynamic value (a template or variable) counts only when the label side uses the same expression text.
 *
 * Ran over every call site on 2026-10-28: none unnamed, so the finding was a check to make, not a defect
 * (the four post-job switches and the review checkbox are each tied to a <label htmlFor>). This guard is
 * the check, kept.
 *
 * @mutate src/components/postjob/BudgetSection.tsx | <Label htmlFor="urgent" className="mb-0 cursor-pointer"> | <Label className="mb-0 cursor-pointer">
 * @mutate src/components/postjob/detailsSection/PhotoProofToggle.tsx |           htmlFor="require-photo-proof" |           htmlFor="require-photo-proof-x"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "../..");
const CONTROLS = new Set(["Switch", "Checkbox"]);
const LABELS = new Set(["label", "Label"]);

const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f) && !f.startsWith("src/test/") && !f.startsWith("src/components/ui/"));

type Attr = { name: string; text: string | null };

function attrs(sf: ts.SourceFile, el: ts.JsxOpeningLikeElement): Attr[] {
  const out: Attr[] = [];
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p)) { out.push({ name: "{...spread}", text: null }); continue; }
    const name = p.name.getText(sf);
    const init = p.initializer;
    let text: string | null = null;
    if (!init) text = "true";
    else if (ts.isStringLiteral(init)) text = init.text;
    else if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      text = ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : `{${e.getText(sf)}}`;
    }
    out.push({ name, text });
  }
  return out;
}

const tagName = (sf: ts.SourceFile, el: ts.JsxOpeningLikeElement) => el.tagName.getText(sf);

/** The controls in `file` that have no accessible name (or, with `every`, every control found, named or not). */
function unnamedControls(file: string, text = readFileSync(resolve(ROOT, file), "utf8"), every = false): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ids = new Set<string>();
  const htmlFors = new Set<string>();
  const controls: { el: ts.JsxOpeningLikeElement; node: ts.Node }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const a = attrs(sf, n);
      for (const x of a) {
        if (x.name === "id" && x.text) ids.add(x.text);
        if (x.name === "htmlFor" && x.text && LABELS.has(tagName(sf, n))) htmlFors.add(x.text);
      }
      if (CONTROLS.has(tagName(sf, n))) controls.push({ el: n, node: ts.isJsxOpeningElement(n) ? n.parent : n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const wrappedByLabel = (node: ts.Node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isJsxElement(p) && LABELS.has(tagName(sf, p.openingElement))) return true;
    }
    return false;
  };

  const out: string[] = [];
  for (const { el, node } of controls) {
    const a = attrs(sf, el);
    const get = (k: string) => a.find((x) => x.name === k)?.text ?? null;
    const label = get("aria-label");
    const labelledby = get("aria-labelledby");
    const id = get("id");
    const named =
      (!!label && label.trim() !== "") ||
      (!!labelledby && labelledby.split(/\s+/).every((ref) => ids.has(ref))) ||
      (!!id && htmlFors.has(id)) ||
      wrappedByLabel(node) ||
      // A spread may carry the name (a wrapper forwarding props); its caller is then the call site checked.
      a.some((x) => x.name === "{...spread}");
    if (!named || every) {
      const { line } = sf.getLineAndCharacterOfPosition(el.getStart(sf));
      out.push(`${file}:${line + 1} <${tagName(sf, el)}>`);
    }
  }
  return out;
}

describe("every Switch and Checkbox has an accessible name (F23)", () => {
  const all = files.flatMap((f) => {
    const t = readFileSync(resolve(ROOT, f), "utf8");
    return /<(Switch|Checkbox)\b/.test(t) ? [{ f, t }] : [];
  });

  it("the inventory is real", () => {
    // 41 files hold 74 such controls on 2026-10-28 (src/components/ui excluded: the primitives themselves).
    expect(all.length).toBeGreaterThan(30);
    const checked = all.reduce((n, { f, t }) => n + unnamedControls(f, t, true).length, 0);
    expect(checked).toBeGreaterThan(60);
  });

  it("no control is left without a name", () => {
    expect(all.flatMap(({ f, t }) => unnamedControls(f, t))).toEqual([]);
  });

  it("the check can fail: a control with no label, and one labelled by an id nobody carries", () => {
    const bad = `export const A = () => (<div><Switch id="a" /><Checkbox aria-labelledby="nope" /><label htmlFor="b">B</label></div>);`;
    expect(unnamedControls("x.tsx", bad)).toEqual(["x.tsx:1 <Switch>", "x.tsx:1 <Checkbox>"]);
    const good = `export const A = () => (<div><span id="t">T</span><Switch aria-labelledby="t" /><label htmlFor="c">C</label><Checkbox id="c" /><label><Switch /> x</label></div>);`;
    expect(unnamedControls("x.tsx", good)).toEqual([]);
  });
});
