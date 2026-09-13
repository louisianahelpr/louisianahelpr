/**
 * A component is never declared inside another component's body (owner,
 * 2026-09-12: "prevent, don't chase").
 *
 * NotificationPreferences declared `const SwitchSlot = (...) => <...>` inside
 * its render function. Every render makes a NEW function, so React sees a new
 * component type, unmounts every <SwitchSlot> and mounts fresh ones. Toggling
 * the push master switch set state twice (optimistic value, saving spinner):
 * the switch under the user's finger was destroyed and rebuilt, and the
 * browser dropped focus to <body>. Same mechanism loses input text, scroll
 * position and animations in anything declared this way.
 *
 * Rule: a capitalised function (declaration or arrow/function expression
 * bound to a `const`/`let`) that contains JSX must not sit inside another
 * such function. Walked with the TypeScript AST, so parameter shape and
 * formatting do not matter. Render helpers that are not components (lower-
 * case names, e.g. `renderRow`) are out of scope: React does not treat them
 * as element types.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const isFnLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

function hasJsx(n: ts.Node): boolean {
  let found = false;
  (function walk(x: ts.Node) {
    if (found) return;
    if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) { found = true; return; }
    ts.forEachChild(x, walk);
  })(n);
  return found;
}

export function offenders(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  function visit(node: ts.Node, enclosing: string | null) {
    let name: string | null = null;
    let fn: ts.Node | null = null;
    if (ts.isFunctionDeclaration(node) && node.name) { name = node.name.text; fn = node; }
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFnLike(node.initializer)) {
      name = node.name.text; fn = node.initializer;
    }
    if (name && fn && /^[A-Z]/.test(name) && hasJsx(fn)) {
      if (enclosing) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        out.push(`${file}:${line + 1}: <${name}> is declared inside ${enclosing}`);
      }
      ts.forEachChild(node, (c) => visit(c, name));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, enclosing));
  }
  visit(sf, null);
  return out;
}

describe("components are declared at module level", () => {
  it("catches the original SwitchSlot-in-NotificationPreferences shape", () => {
    const before = `
      const NotificationPreferences = () => {
        const [loaded, setLoaded] = useState(false);
        const SwitchSlot = ({
          checked, onCheckedChange,
        }: { checked: boolean; onCheckedChange: () => void }) => (
          <div>{loaded ? <Switch checked={checked} onCheckedChange={onCheckedChange} /> : null}</div>
        );
        return <SwitchSlot checked onCheckedChange={() => {}} />;
      };`;
    expect(offenders("x.tsx", before)).toEqual(["x.tsx:4: <SwitchSlot> is declared inside NotificationPreferences"]);
    const after = `
      const SwitchSlot = ({ checked, loaded }: { checked: boolean; loaded: boolean }) => (
        <div>{loaded ? <Switch checked={checked} /> : null}</div>
      );
      const NotificationPreferences = () => {
        const [loaded] = useState(false);
        return <SwitchSlot checked loaded={loaded} />;
      };`;
    expect(offenders("x.tsx", after)).toEqual([]);
    // function declarations count too
    expect(offenders("x.tsx", `function Page() { function Row() { return <li />; } return <ul><Row /></ul>; }`)).toHaveLength(1);
    // a lower-case render helper is not a component type
    expect(offenders("x.tsx", `function Page() { const renderRow = () => <li />; return <ul>{renderRow()}</ul>; }`)).toEqual([]);
  });

  it("no component is declared inside another anywhere in src/", () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) hits.push(...offenders(p, readFileSync(p, "utf8")));
      }
    })("src");
    expect(hits, "hoist it to module level and pass what it closed over as props").toEqual([]);
  });
});
