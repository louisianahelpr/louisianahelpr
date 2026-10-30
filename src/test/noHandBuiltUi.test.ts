/**
 * CLASS GUARD: no hand-built UI outside src/components/ui/.
 *
 * Owner, 2026-10-29: "nothing should be hand made. everything should basically
 * all be shared components, so if something is handmade fix it now."
 *
 * Read from the TypeScript AST of every tracked .ts/.tsx under src/ (tests,
 * src/test/ and src/components/ui/ itself excluded), so a comment can neither
 * hide nor invent a hit. Kinds, each with the shared component that replaces it:
 *   button          raw <button>                       -> ui Button / ChoicePill / SectionActionPill / RadioCardList
 *   input           raw <input> (text, number, …)      -> ui Input / CurrencyInput
 *   checkbox        raw <input type="checkbox">        -> ui Checkbox / Switch
 *   radio           raw <input type="radio">           -> ui RadioCardList / SegmentedControl
 *   select          raw <select>                       -> ui Select
 *   textarea        raw <textarea>                     -> ui Textarea
 *   dialog          <dialog> or role="dialog"/"alertdialog" -> ui Dialog / Sheet / DialogShell
 *   spinner         a string carrying animate-spin     -> ui Spinner (or HelprSpinner for page loads)
 *   skeleton        a string carrying animate-pulse    -> ui Skeleton
 * `<input type="file">` (noRawFilePicker.test.tsx owns it; PhotoPickButton keeps
 * a real hidden input) and `<input type="hidden">` are not counted.
 *
 * The baseline (src/test/handBuiltUi.baseline.json) is EXACT and TWO-WAY:
 *   - `files`: per file, per kind, the count still to convert. A count above it
 *     fails (new hand-built UI); a count below it fails too, so the gain is held
 *     (lower the entry, or rewrite the file with HAND_BUILT_UI_WRITE=1).
 *   - `exceptions`: "file::kind" -> a written reason. That file/kind is not
 *     counted at all; an exception whose file/kind has no hit left fails.
 *
 * @mutate src/pages/profile/strSettings/AddCalendarForm.tsx | <Loader2 className="w-4 h-4 animate-spin mr-2" /> | <Loader2 className="w-4 h-4 mr-2" />
 * @mutate src/pages/user/ReviewsSection.tsx | import ReportDialog from "@/components/ReportDialog"; | import ReportDialog from "@/components/ReportDialog";\nexport const Planted = () => <select aria-label="x" />;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const BASELINE_PATH = "src/test/handBuiltUi.baseline.json";

export type Kind = "button" | "input" | "checkbox" | "radio" | "select" | "textarea" | "dialog" | "spinner" | "skeleton";
export interface Hit { line: number; kind: Kind }

const strText = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
    ? n.text
    : null;

/** Literal text of a JSX attribute value (`"x"`, `{"x"}`), else null. */
function attrLiteral(init: ts.JsxAttributeValue | undefined): string | null {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) return strText(init.expression);
  return null;
}

/** Every hand-built hit in one file. */
export function handBuiltHits(file: string, src: string): Hit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const attr = (name: string) => {
        for (const a of n.attributes.properties) if (ts.isJsxAttribute(a) && a.name.getText(sf) === name) return a;
        return undefined;
      };
      let kind: Kind | null = null;
      if (tag === "button") kind = "button";
      else if (tag === "select") kind = "select";
      else if (tag === "textarea") kind = "textarea";
      else if (tag === "dialog") kind = "dialog";
      else if (tag === "input") {
        const typeAttr = attr("type");
        const type = typeAttr ? attrLiteral(typeAttr.initializer) : "text";
        if (type === "checkbox") kind = "checkbox";
        else if (type === "radio") kind = "radio";
        else if (type !== "file" && type !== "hidden") kind = "input";
      }
      const role = attr("role");
      if (!kind && role && /^(dialog|alertdialog)$/.test(attrLiteral(role.initializer) ?? "")) kind = "dialog";
      if (kind) hits.push({ line: at(n), kind });
    }
    const text = strText(n);
    if (text !== null) {
      if (/(?<![\w-])animate-spin(?![\w-])/.test(text)) hits.push({ line: at(n), kind: "spinner" });
      if (/(?<![\w-])animate-pulse(?![\w-])/.test(text)) hits.push({ line: at(n), kind: "skeleton" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

type Counts = Record<string, Partial<Record<Kind, number>>>;
interface Baseline { files: Counts; exceptions: Record<string, string> }

/** Problems between what the tree has and what the baseline says. Two-way. */
export function baselineProblems(actual: Counts, baseline: Baseline, present: Set<string>): string[] {
  const problems: string[] = [];
  for (const [key, reason] of Object.entries(baseline.exceptions)) {
    if (!reason || reason.trim().length < 12) problems.push(`exception ${key} has no written reason`);
    if (!present.has(key)) problems.push(`stale exception ${key}: no hit left — remove it`);
  }
  const files = new Set([...Object.keys(actual), ...Object.keys(baseline.files)]);
  for (const f of [...files].sort()) {
    const kinds = new Set([...Object.keys(actual[f] ?? {}), ...Object.keys(baseline.files[f] ?? {})]) as Set<Kind>;
    for (const k of kinds) {
      const is = actual[f]?.[k] ?? 0;
      const was = baseline.files[f]?.[k] ?? 0;
      if (is > was)
        problems.push(`${f}: hand-built ${k} ROSE from ${was} to ${is}. Use the shared component in src/components/ui/ (see this test's header).`);
      else if (is < was)
        problems.push(`${f}: hand-built ${k} FELL from ${was} to ${is} — good. Lower the baseline entry to ${is} in this commit (HAND_BUILT_UI_WRITE=1 rewrites it).`);
    }
  }
  return problems;
}

const SOURCES = trackedFiles("src").filter(
  (f) =>
    /\.tsx?$/.test(f) &&
    !/\.test\.tsx?$/.test(f) &&
    !f.startsWith("src/test/") &&
    !f.startsWith("src/components/ui/") &&
    !f.endsWith(".d.ts"),
);

describe("no hand-built UI outside src/components/ui/ (owner, 2026-10-29)", () => {
  it("every hand-built control is in the exact baseline, which only shrinks", () => {
    const baseline = JSON.parse(readFileSync(resolve(ROOT, BASELINE_PATH), "utf8")) as Baseline;
    const actual: Counts = {};
    const present = new Set<string>();
    let total = 0;
    for (const f of SOURCES) {
      for (const h of handBuiltHits(f, readFileSync(resolve(ROOT, f), "utf8"))) {
        const key = `${f}::${h.kind}`;
        present.add(key);
        if (key in baseline.exceptions) continue;
        total++;
        (actual[f] ??= {})[h.kind] = (actual[f]![h.kind] ?? 0) + 1;
      }
    }
    if (process.env.HAND_BUILT_UI_WRITE === "1") {
      const sorted: Counts = {};
      for (const f of Object.keys(actual).sort()) sorted[f] = Object.fromEntries(Object.entries(actual[f]).sort());
      writeFileSync(resolve(ROOT, BASELINE_PATH), JSON.stringify({ ...baseline, files: sorted }, null, 2) + "\n");
      return;
    }
    // Inventory floors: the scan reached the app (measured 2026-10-29: 375 files, ~890 hits).
    expect(SOURCES.length).toBeGreaterThan(800);
    expect(total).toBeGreaterThan(300);
    const problems = baselineProblems(actual, baseline, present);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the scanner and the baseline check catch what they claim to (fixtures)", () => {
    const src = `
      const CLS = "h-4 w-4 animate-spin";
      export const A = () => (<>
        {/* <button>not a button</button> */}
        <button type="button">raw</button>
        <Button>shared</Button>
        <input value={v} />
        <input type="checkbox" />
        <input type={"radio"} />
        <input type="file" className="sr-only" />
        <input type="hidden" />
        <select />
        <textarea />
        <div role="dialog" />
        <div className="motion-safe:animate-pulse" />
      </>);`;
    const kinds = handBuiltHits("f.tsx", src).map((h) => h.kind).sort();
    expect(kinds).toEqual(["button", "checkbox", "dialog", "input", "radio", "select", "skeleton", "spinner", "textarea"]);
    const base: Baseline = { files: { "a.tsx": { button: 2 } }, exceptions: { "b.tsx::input": "a real reason here" } };
    expect(baselineProblems({ "a.tsx": { button: 2 } }, base, new Set(["b.tsx::input"]))).toEqual([]);
    expect(baselineProblems({ "a.tsx": { button: 3 } }, base, new Set(["b.tsx::input"]))[0]).toMatch(/ROSE from 2 to 3/);
    expect(baselineProblems({ "a.tsx": { button: 1 } }, base, new Set(["b.tsx::input"]))[0]).toMatch(/FELL from 2 to 1/);
    expect(baselineProblems({ "a.tsx": { button: 2 } }, base, new Set())[0]).toMatch(/stale exception b.tsx::input/);
    expect(baselineProblems({ "c.tsx": { select: 1 } }, { files: {}, exceptions: {} }, new Set())[0]).toMatch(/select ROSE from 0 to 1/);
  });
});
