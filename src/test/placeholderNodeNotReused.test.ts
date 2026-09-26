/*
 * A LOADING PLACEHOLDER'S DOM NODE IS NEVER HANDED TO THE CONTENT THAT
 * REPLACES IT WHEN SOMETHING CAN LAND ABOVE IT IN THE SAME COMMIT.
 *
 * The shape (Q169 class, measured on /messages): inside one parent,
 *
 *     {!loading && banner && <Banner/>}       ← appears only once loaded
 *     {loading ? <div>bones</div> : <div>list</div>}
 *
 * Both branches of the ternary are a bare <div> in the same slot, so React
 * reuses the bones' node for the list. When the banner lands in the same
 * commit, that ONE node moves down by the banner's height, and the browser
 * scores a node that existed in both frames and moved as a layout shift:
 * prod-audit page-settle "375 /messages: cls=0.0558" (div.space-y-2 139→205)
 * and "1440 /messages: cls=0.0216", runs 36003051878 / 36069316906. Distinct
 * `key`s make the bones leave and the list arrive as new content — which is
 * what happens on screen.
 *
 * Inventory is every `{X ? … : …}` in src/**\/*.tsx whose condition is a
 * loading flag (identifier matching /loading/i); a site is AT RISK when an
 * earlier sibling in the same JSX parent renders only when `!X`. At an at-risk
 * site, a branch whose root tag matches the loading branch's must carry a key
 * different from the loading branch's (two absent keys are equal).
 *
 * @mutate src/components/messages/ConversationList.tsx | <div key="threads" className="space-y-2"> | <div key="bones" className="space-y-2">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "..", "..");
const LOADING = /loading/i;

const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);

function tagOf(e: ts.Expression): { tag: string; key: string | null } | null {
  const n = unwrap(e);
  const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
  if (!open) return null;
  let key: string | null = null;
  for (const a of open.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === "key") key = a.initializer ? a.initializer.getText() : "";
  }
  return { tag: open.tagName.getText(), key };
}

/** Identifiers X for which `expr` contains `!X`. */
function negatedFlags(expr: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
      const o = unwrap(n.operand);
      if (ts.isIdentifier(o) && LOADING.test(o.text)) out.add(o.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return out;
}

interface Site { file: string; line: number; flag: string; atRisk: boolean; problem: string | null }

function scan(file: string): Site[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: Site[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const seenNegated = new Set<string>();
      for (const child of node.children) {
        if (!ts.isJsxExpression(child) || !child.expression) continue;
        const e = unwrap(child.expression);
        if (ts.isConditionalExpression(e) && ts.isIdentifier(unwrap(e.condition)) && LOADING.test((unwrap(e.condition) as ts.Identifier).text)) {
          const flag = (unwrap(e.condition) as ts.Identifier).text;
          const atRisk = seenNegated.has(flag);
          let problem: string | null = null;
          if (atRisk) {
            const first = tagOf(e.whenTrue);
            const rest: ts.Expression[] = [];
            let f: ts.Expression = unwrap(e.whenFalse);
            while (ts.isConditionalExpression(f)) { rest.push(f.whenTrue); f = unwrap(f.whenFalse); }
            rest.push(f);
            if (first) {
              for (const r of rest) {
                const t = tagOf(r);
                if (!t || t.tag !== first.tag) continue;
                // React reuses the node only when the keys are EQUAL (both absent counts).
                if (first.key === t.key) {
                  problem = `<${first.tag}> placeholder and <${t.tag}> content share a node (keys ${first.key ?? "none"} / ${t.key ?? "none"})`;
                  break;
                }
              }
            }
          }
          sites.push({ file: relative(ROOT, file), line: sf.getLineAndCharacterOfPosition(child.getStart()).line + 1, flag, atRisk, problem });
        }
        if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          for (const f of negatedFlags(e.left)) seenNegated.add(f);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const files = walkSource([resolve(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/src/test/"));
const sites = files.flatMap(scan);

describe("a loading placeholder's node is not reused by content that lands under a new sibling", () => {
  it("the inventory is the app's own and not empty", () => {
    // Floor: far fewer loading ternaries than src holds means the parser broke.
    expect(sites.length).toBeGreaterThan(20);
    // The /messages inbox is the site this was written for; it must be seen as at risk.
    expect(sites.some((s) => s.atRisk && s.file === "src/components/messages/ConversationList.tsx")).toBe(true);
  });

  it("every at-risk site keys its placeholder apart from the content", () => {
    const bad = sites.filter((s) => s.problem).map((s) => `${s.file}:${s.line} {${s.flag} ? …}: ${s.problem}`);
    expect(bad, "a `{!loading && …}` sibling lands above this ternary in the same commit; key the branches apart").toEqual([]);
  });
});
