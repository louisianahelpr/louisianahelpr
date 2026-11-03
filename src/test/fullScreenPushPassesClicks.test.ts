/**
 * CLASS GUARD (docs/OPEN.md Q2342): a portalled full-screen push never swallows
 * the desktop chrome's clicks.
 *
 * The Applicants overlay is a `fixed inset-0` wrapper portalled to <body> around
 * an <AppPage>. From 900px AppShell's frame starts below the desktop top bar and
 * right of the rail, so both stay DRAWN, but the transparent inset-0 wrapper
 * sat on top of them: elementFromPoint over Post a job, Help, the bell, the
 * avatar and every rail row returned the wrapper (measured at 1440, mocked
 * session, 2026-11-02), so each tap did nothing.
 *
 * Inventory from source: every .tsx under src/ that calls createPortal and has a
 * JSX element whose className holds `fixed` and `inset-0` and whose FIRST JSX
 * child is <AppPage>. Each must carry `pointer-events-none` and
 * `[&>*]:pointer-events-auto` (the wrapper takes no clicks; its children do).
 * A blocking overlay with no AppPage inside (RedirectingOverlay) is not a push
 * and is not counted.
 */
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | className="pointer-events-none [&>*]:pointer-events-auto fixed inset-0 z-50 | className="fixed inset-0 z-50
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

type Push = { file: string; className: string };

function classNameOf(el: ts.JsxOpeningLikeElement): string | null {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== "className" || !p.initializer) continue;
    if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
    if (ts.isJsxExpression(p.initializer) && p.initializer.expression) return p.initializer.expression.getText();
  }
  return null;
}

function firstJsxChildTag(el: ts.JsxElement): string | null {
  for (const c of el.children) {
    if (ts.isJsxText(c) && c.text.trim() === "") continue;
    if (ts.isJsxExpression(c) && !c.expression) continue; // a {/* comment */}
    if (ts.isJsxElement(c)) return c.openingElement.tagName.getText();
    if (ts.isJsxSelfClosingElement(c)) return c.tagName.getText();
    return null;
  }
  return null;
}

export function fullScreenPushes(source: string, file: string): Push[] {
  const code = blankComments(source);
  if (!/\bcreatePortal\s*\(/.test(code)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Push[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) {
      const cls = classNameOf(n.openingElement);
      if (cls && /(^|[\s"'`])fixed(\s|$)/.test(cls) && /(^|\s)inset-0(\s|$)/.test(cls) && firstJsxChildTag(n) === "AppPage") {
        out.push({ file, className: cls });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const passesClicks = (cls: string) => /(^|\s)pointer-events-none(\s|$)/.test(cls) && cls.includes("[&>*]:pointer-events-auto");

describe("a portalled full-screen push leaves the desktop chrome clickable (Q2342)", () => {
  const pushes = walkSource([resolve(ROOT, "src")], [".tsx"])
    .filter((f) => !/\.test\.tsx$/.test(f))
    .flatMap((f) => {
      const src = readSource(f);
      return src ? fullScreenPushes(src, relative(ROOT, f)) : [];
    });

  it("finds the pushes it guards (inventory floor)", () => {
    expect(pushes.map((p) => p.file)).toContain("src/pages/posts/postedJobs/ApplicantsPanel.tsx");
    expect(pushes.length).toBeGreaterThan(0);
  });

  it("every push wrapper takes no clicks and hands them to its children", () => {
    expect(pushes.filter((p) => !passesClicks(p.className))).toEqual([]);
  });

  it("the detector sees a wrapper without the fix and ignores a blocking overlay", () => {
    const bad = `import { createPortal } from "react-dom";\nexport const X = () => createPortal(<div className="fixed inset-0 z-50">{/* c */}<AppPage title="A" /></div>, document.body);`;
    const blocker = `import { createPortal } from "react-dom";\nexport const Y = () => createPortal(<div className="fixed inset-0 z-50"><Spinner /></div>, document.body);`;
    const found = fullScreenPushes(bad, "bad.tsx");
    expect(found).toHaveLength(1);
    expect(passesClicks(found[0].className)).toBe(false);
    expect(fullScreenPushes(blocker, "blocker.tsx")).toEqual([]);
  });
});
