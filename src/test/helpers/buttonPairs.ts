/**
 * Every side-by-side pair of <Button>s in src/ (owner 11-01: a pair reads on ONE line, the green primary on the
 * RIGHT). A pair is a JSX element whose className has `flex` (not flex-col, nor a column on phones) and whose
 * element children are exactly two <Button>s. Read with the TypeScript parser, comments ignored by construction.
 */
import ts from "typescript";

export interface ButtonPairSide {
  /** The Button's variant attribute: a literal, "<expr>" when computed, or "default" when absent (= primary). */
  variant: string;
  /** Its className and size text (literal or the source of an expression). */
  className: string;
  size: string;
  /** Its text children, for the report. */
  text: string;
}
export interface ButtonPair { file: string; line: number; left: ButtonPairSide; right: ButtonPairSide }

const attr = (el: ts.JsxOpeningLikeElement, name: string, sf: ts.SourceFile): string | null => {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== name) continue;
    if (!p.initializer) return "true";
    if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
    return `<${p.initializer.getText(sf)}>`;
  }
  return null;
};
const opening = (n: ts.Node): ts.JsxOpeningLikeElement | null =>
  ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;

export function buttonPairsIn(file: string, source: string): ButtonPair[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ButtonPair[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) {
      const cls = attr(n.openingElement, "className", sf) ?? "";
      const row = /(^|[\s"`<{])flex(\s|$|["`])/.test(cls) && !/\bflex-col\b/.test(cls) && !/\bgrid\b/.test(cls);
      const kids = n.children.filter((c) => !(ts.isJsxText(c) && c.text.trim() === "") && !(ts.isJsxExpression(c) && !c.expression));
      const buttons = kids.map(opening).filter((o): o is ts.JsxOpeningLikeElement => !!o && o.tagName.getText(sf) === "Button");
      if (row && kids.length === 2 && buttons.length === 2) {
        const side = (o: ts.JsxOpeningLikeElement, el: ts.Node): ButtonPairSide => ({
          variant: attr(o, "variant", sf) ?? "default",
          className: attr(o, "className", sf) ?? "",
          size: attr(o, "size", sf) ?? "default",
          text: ts.isJsxElement(el) ? el.children.map((c) => c.getText(sf)).join("").replace(/\s+/g, " ").trim().slice(0, 60) : "",
        });
        out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, left: side(buttons[0], kids[0]), right: side(buttons[1], kids[1]) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export const isPrimary = (s: ButtonPairSide) => s.variant === "primary" || s.variant === "default";
/** A side that may wrap its words onto a second line. */
export const mayWrap = (s: ButtonPairSide) => s.size === "wrap" || /\bwhitespace-normal\b|\bwhitespace-pre-line\b|\bbreak-words\b/.test(s.className);
