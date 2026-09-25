// @mutate src/components/profile/savedHelpersTab/SavedHelperCard.tsx |       <div className={isEditingNote ? "relative z-10" : undefined}> |       <div className="relative z-10">
/**
 * CLASS GUARD: inside a card whose whole-card tap is a STRETCHED LINK (a
 * <Link>/<a> positioned `absolute inset-0` over the card), only CONTROLS are
 * raised above the link.
 *
 * The pattern: the link covers the card, and the card's own buttons sit over it
 * with `relative z-10` so they receive their own presses. Raise a block that
 * renders no control and it becomes a dead patch: a tap on it lands on neither
 * the link nor anything else. press-every-control run 36069319716,
 * /profile?tab=saved_helpers (customer):
 *
 *   "View Hallie H.'s profile" — NOT CLICKABLE (covered: <p class="font-sans
 *   text-ds-13 leading-snug flex-1 min-w-0">SEED Great with fences.</p> from
 *   <div class="relative z-10">…</div> subtree intercepts pointer events)
 *
 * SavedHelperCard raised its note block for the editor's sake, and the same
 * block rendered the read-only note when not editing.
 *
 * Parsed with the TypeScript compiler. A raised element passes only when EVERY
 * render path of its subtree contains a control; a conditional className is
 * followed into children that branch on the same condition.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));

const LINKS = new Set(["Link", "NavLink", "a"]);
const CONTROLS = new Set(["button", "Button", "a", "Link", "NavLink", "textarea", "Textarea", "input", "Input", "select", "Select", "Checkbox", "Switch"]);
const RAISED = /\bz-(?:[1-9]\d*|\[[1-9]\d*\])\b/;

type El = ts.JsxElement | ts.JsxSelfClosingElement;
const opening = (e: El) => (ts.isJsxElement(e) ? e.openingElement : e);

/** className as { always } string, or { cond, whenTrue, whenFalse } for `c ? "…" : "…"`. */
function classOf(e: El, sf: ts.SourceFile): { text: string; cond?: string; raisedWhen?: boolean } | null {
  for (const p of opening(e).attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== "className" || !p.initializer) continue;
    if (ts.isStringLiteral(p.initializer)) return { text: p.initializer.text };
    if (ts.isJsxExpression(p.initializer) && p.initializer.expression) {
      let x = p.initializer.expression;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isConditionalExpression(x)) {
        const t = ts.isStringLiteralLike(x.whenTrue) ? x.whenTrue.text : "";
        const f = ts.isStringLiteralLike(x.whenFalse) ? x.whenFalse.text : "";
        const cond = x.condition.getText(sf);
        if (RAISED.test(t) && !RAISED.test(f)) return { text: t, cond, raisedWhen: true };
        if (RAISED.test(f) && !RAISED.test(t)) return { text: f, cond, raisedWhen: false };
        return { text: `${t} ${f}` };
      }
      return { text: x.getText(sf) };
    }
  }
  return null;
}

const hasOnClick = (e: El, sf: ts.SourceFile) =>
  opening(e).attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "onClick");

/** Does EVERY way this node can render contain a control? `known` pins conditions to a value. */
function alwaysHasControl(n: ts.Node, sf: ts.SourceFile, known: Map<string, boolean>): boolean {
  if (ts.isParenthesizedExpression(n)) return alwaysHasControl(n.expression, sf, known);
  if (ts.isJsxExpression(n)) return n.expression ? alwaysHasControl(n.expression, sf, known) : false;
  if (ts.isJsxSelfClosingElement(n)) return CONTROLS.has(n.tagName.getText(sf)) || hasOnClick(n, sf);
  if (ts.isJsxElement(n)) {
    if (CONTROLS.has(n.openingElement.tagName.getText(sf)) || hasOnClick(n, sf)) return true;
    return n.children.some((c) => alwaysHasControl(c, sf, known));
  }
  if (ts.isJsxFragment(n)) return n.children.some((c) => alwaysHasControl(c, sf, known));
  if (ts.isConditionalExpression(n)) {
    const k = known.get(n.condition.getText(sf));
    if (k === true) return alwaysHasControl(n.whenTrue, sf, known);
    if (k === false) return alwaysHasControl(n.whenFalse, sf, known);
    return alwaysHasControl(n.whenTrue, sf, known) && alwaysHasControl(n.whenFalse, sf, known);
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return alwaysHasControl(n.right, sf, known);
  }
  return false;
}

/** Raised blocks inside a stretched-link card that can render with no control. */
function deadRaisedBlocks(file: string, text: string): { stretched: number; dead: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let stretched = 0;
  const dead: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && LINKS.has(opening(node).tagName.getText(sf))) {
      const cls = classOf(node, sf)?.text ?? "";
      const card = node.parent && ts.isJsxElement(node.parent) ? node.parent : null;
      if (card && /\babsolute\b/.test(cls) && /\binset-0\b/.test(cls)) {
        stretched++;
        const scan = (n: ts.Node): void => {
          if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && n !== node) {
            const c = classOf(n, sf);
            if (c && RAISED.test(c.text)) {
              const known = new Map<string, boolean>();
              if (c.cond !== undefined) known.set(c.cond, c.raisedWhen!);
              const self = CONTROLS.has(opening(n).tagName.getText(sf)) || hasOnClick(n, sf);
              const inner = ts.isJsxElement(n) && n.children.some((ch) => alwaysHasControl(ch, sf, known));
              if (!self && !inner) dead.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
              return; // a raised control's own subtree is its business
            }
          }
          ts.forEachChild(n, scan);
        };
        card.children.forEach(scan);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { stretched, dead };
}

describe("a stretched-link card raises only controls above its link", () => {
  it("the parser catches the original SavedHelperCard shape and passes the fixed one", () => {
    const card = (cls: string) => `const C = ({ e, note }) => (<div className="relative">
<Link to="/u" aria-label="View" className="absolute inset-0 z-0" />
<p>Name</p>
{note && (
<div className=${cls}>
{e ? <textarea /> : <div><p>{note}</p></div>}
</div>)}
<div className="relative z-10 flex"><Button>Offer</Button></div>
</div>);`;
    expect(deadRaisedBlocks("orig.tsx", card(`"relative z-10"`)).dead).toEqual(["orig.tsx:5"]);
    expect(deadRaisedBlocks("fixed.tsx", card(`{e ? "relative z-10" : undefined}`)).dead).toEqual([]);
  });

  it("no shipped stretched-link card raises a block without a control", () => {
    expect(FILES.length).toBeGreaterThan(400);
    let stretched = 0;
    const dead: string[] = [];
    for (const f of FILES) {
      const r = deadRaisedBlocks(f, readFileSync(resolve(ROOT, f), "utf8"));
      stretched += r.stretched;
      dead.push(...r.dead);
    }
    expect(stretched).toBeGreaterThanOrEqual(1);
    expect(dead).toEqual([]);
  });
});
