/**
 * CLASS GUARD: no <Button>/<button> is rendered INSIDE a <Link>/<NavLink>/<a>.
 *
 * Q179 (2026-09-23 visual walk, /reset-password on prod at 375 and 1440): the
 * "Request a Reset Link" button sat flush against the paragraph above it —
 * 0px, measured — inside a `space-y-4` stack. The wrapper was an inline <a>
 * (react-router <Link>) around a <Button>, so the stack's margin landed on an
 * inline box and did nothing. It is also invalid HTML (interactive content
 * inside an anchor: two tab stops, two roles, for one action).
 *
 * The house pattern is `<Button asChild><Link …/></Button>` — one element, the
 * anchor, wearing the button's styling. Parsed with the TypeScript compiler,
 * so comments and strings cannot trip it.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// @mutate src/pages/ResetPassword.tsx | <Button asChild variant="outline" className="w-full rounded-ds-md"> | <Button asChild variant="outline" className="w-full rounded-ds-md"><Link to="/x"><Button>x</Button></Link>

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));

const ANCHORS = new Set(["Link", "NavLink", "a"]);
const BUTTONS = new Set(["Button", "button"]);

function nestedButtons(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const tagOf = (n: ts.Node) =>
    ts.isJsxElement(n) ? n.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(n) ? n.tagName.getText(sf) : null;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && ANCHORS.has(node.openingElement.tagName.getText(sf))) {
      for (const child of node.children) {
        const t = tagOf(child);
        if (t && BUTTONS.has(t)) {
          hits.push(`${file}:${sf.getLineAndCharacterOfPosition(child.getStart(sf)).line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("no button nested inside a link (Q179)", () => {
  it("scans every shipped .tsx", () => {
    expect(FILES.length).toBeGreaterThan(400);
  });

  it("the parser catches the original shape", () => {
    const original = `const X = () => (<div><Link to="/forgot-password">\n<Button variant="outline">Go</Button>\n</Link></div>);`;
    expect(nestedButtons("fixture.tsx", original)).toEqual(["fixture.tsx:2"]);
    expect(nestedButtons("ok.tsx", `const Y = () => <Button asChild><Link to="/x">Go</Link></Button>;`)).toEqual([]);
  });

  it("no shipped file nests one", () => {
    const hits = FILES.flatMap((f) => nestedButtons(f, readFileSync(resolve(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });
});
