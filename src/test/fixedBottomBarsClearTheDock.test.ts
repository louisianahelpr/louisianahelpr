/**
 * CLASS CHECK (Q1646): no fixed bottom bar can render under the bottom dock.
 *
 * The bug: Edit Profile's SaveBar was `fixed bottom-0 z-40`, flush on the
 * screen edge, exactly where MobileNav's dock (`fixed bottom-0 z-50`) sits.
 * e2e-journeys 38157785191 (2026-10-11, chromium and webkit at tablet-768):
 * "Save Changes" could not be clicked for 20s because the dock's Profile tab
 * took the pointer. A z-index on the bar cannot fix it: the bar renders inside
 * <PageTransition>, whose `will-change: transform` makes the page its own
 * stacking context, so the whole page paints under the dock's z-50.
 *
 * INVENTORY: the TypeScript AST of every non-test .tsx file in src/. A JSX
 * element whose className carries the `fixed` token (or whose style says
 * `position: "fixed"`) and is anchored at the BOTTOM (a `bottom-*` class or a
 * `bottom` style) without also being anchored at the top (`top-*`, `inset-0`,
 * `inset-y-0`, or a `top` style: full-height frames and rails are not bars) is
 * a fixed bottom bar. Each one must either
 *   (a) float above the dock on the shared clearance: `bottom-safe-nav`, or a
 *       `bottom` style that reads `var(--bottom-nav-h`; or
 *   (b) make the dock yield while it shows: its file calls `useDockYield(`,
 *       and src/index.css hides `.mobile-nav-frame` under `html.dock-yield`; or
 *   (c) be the dock itself (`mobile-nav-frame`); or
 *   (d) sit in EXACT_EXCEPTIONS below with the measured reason it cannot
 *       collide with the dock. That list is exact and two-way.
 *
 * The live counterpart is e2e/journeys/03-account.spec.ts "edit a profile
 * field": before pressing Save Changes it asserts the point at the button's
 * centre hits the button, on the real backend, at the rotation's viewport.
 */
// @mutate src/components/profile/profileEditForm/SaveBar.tsx | useDockYield(shown); | void shown;
// @mutate src/index.css | html.dock-yield .mobile-nav-frame {\n  visibility: hidden;\n} | html.dock-yield .mobile-nav-frame {\n  opacity: 1;\n}
// @mutate src/pages/posts/BulkDismissBar.tsx | className="fixed inset-x-0 bottom-safe-nav z-40 px-4" | className="fixed inset-x-0 bottom-0 z-40 px-4"
// @mutate src/index.css | html.dock-yield .mobile-nav-frame,\nhtml.dock-yield .mobile-nav-frame * { | html.dock-yield .mobile-nav-frame {
// @mutate src/index.css |   transition: none !important;\n} |   transition-duration: 0.2s;\n}
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import ts from "typescript";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { blankComments, blankCssComments } from "@/test/helpers/blankNonCode";
import { DOCK_YIELD_CLASS, useDockYield } from "@/components/mobileNav/useDockYield";

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));

// @two-way src/test/fixedBottomBarsClearTheDock.test.ts:stale fixed-bottom-bar exception
const EXACT_EXCEPTIONS: Record<string, { count: number; why: string }> = {
  "src/components/admin/AdminPayoutBatches.tsx": {
    count: 1,
    why: "an /admin page: /admin is in noNavPages (mobileNavHelpers.ts), so no dock renders there",
  },
  "src/components/messages/ConversationList.tsx": {
    count: 1,
    why: "bulk-hide bar at a hand-typed safe-area + 80px, above the dock's 62px box (h-14 pill + mb-1.5); it does not read --bottom-nav-h",
  },
  "src/components/ScrollToTop.tsx": {
    count: 1,
    why: "a 44px round button, not a bar, at a hand-typed safe-area + 112px, above the dock",
  },
};

interface BottomBar {
  file: string;
  line: number;
  classText: string;
  styleBottom: string | null;
}

/** Every string/template literal piece inside a node, joined by spaces. */
function literalText(node: ts.Node): string {
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) parts.push(n.text);
    n.forEachChild(visit);
  };
  visit(node);
  return parts.join(" ");
}

function styleProps(attr: ts.JsxAttribute | undefined, sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  const init = attr?.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return out;
  const obj = init.expression;
  if (!ts.isObjectLiteralExpression(obj)) return out;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      out.set(p.name.text, p.initializer.getText(sf));
    }
  }
  return out;
}

function inventory(file: string, src: string): BottomBar[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bars: BottomBar[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
      const byName = (name: string) => attrs.find((a) => a.name.getText(sf) === name);
      const cls = byName("className");
      const classText = cls?.initializer ? literalText(cls.initializer) : "";
      const tokens = new Set(classText.split(/\s+/).filter(Boolean));
      const style = styleProps(byName("style"), sf);
      const fixed = tokens.has("fixed") || /^["'`]fixed["'`]$/.test(style.get("position") ?? "");
      const tokenList = [...tokens];
      const bottomAnchored = tokenList.some((t) => /^bottom-/.test(t)) || style.has("bottom");
      const topAnchored =
        tokenList.some((t) => /^(top-|inset-0$|inset-y-0$)/.test(t)) || style.has("top") || style.has("inset");
      if (fixed && bottomAnchored && !topAnchored) {
        bars.push({
          file,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          classText,
          styleBottom: style.get("bottom") ?? null,
        });
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return bars;
}

function clearsTheDock(b: BottomBar): boolean {
  return b.classText.split(/\s+/).includes("bottom-safe-nav") || /var\(--bottom-nav-h\b/.test(b.styleBottom ?? "");
}

const CSS = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
/** The rule that makes the dock yield: `html.dock-yield .mobile-nav-frame { visibility: hidden }`. */
function cssHidesDockOnYield(css: string): boolean {
  const re = new RegExp(`html\\.${DOCK_YIELD_CLASS}\\s+\\.mobile-nav-frame\\s*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(re)) if (/(^|;|\s)visibility\s*:\s*hidden\s*(;|$)/.test(m[1].trim())) return true;
  return false;
}

/**
 * WebKit half of Q1646 (looked at 2026-10-12, e2e-journeys 38181872855 webkit
 * milestone `edit-profile-dirty`): with `html.dock-yield` set, the dock's pill
 * and Post FAB were hidden but the five tab glyphs were still painted over
 * Save Changes. `visibility` is animatable and inherited: an element whose
 * transition list covers it (`transition-all`, an arbitrary
 * `transition-[...visibility...]`, an inline `transition: all ...`) runs the
 * inherited visible -> hidden change as a transition that stays `visible` for
 * its whole duration. The glyphs are exactly the dock's `transition-all`
 * elements; the pill (`transition-shadow`) and the FAB (`transition-transform`)
 * are not, and were hidden. So while the dock yields, no transition may run
 * inside it.
 *
 * INVENTORY: the dock's own source (MobileNav.tsx and src/components/mobileNav/),
 * comments blanked; every class token or inline transition that covers
 * `visibility`. It is non-empty today (the Icon and UserAvatar glyphs), which
 * is why the stylesheet rule is load-bearing.
 */
const DOCK_FILES = [
  "src/components/MobileNav.tsx",
  ...FILES.filter((f) => f.startsWith("src/components/mobileNav/")),
];
function transitionsCoveringVisibility(src: string): string[] {
  const code = blankComments(src);
  const hits: string[] = [];
  for (const m of code.matchAll(/(?<![\w-])transition-all(?![\w-])/g)) hits.push(m[0]);
  for (const m of code.matchAll(/(?<![\w-])transition-\[([^\]]*)\]/g)) if (/\b(all|visibility)\b/.test(m[1])) hits.push(m[0]);
  for (const m of code.matchAll(/\btransition(?:Property)?\s*:\s*["'`]([^"'`]*)["'`]/g)) if (/\b(all|visibility)\b/.test(m[1])) hits.push(m[0]);
  return hits;
}
/** One rule covers `html.dock-yield .mobile-nav-frame` AND its `*` descendants with `transition: none`. */
function cssStopsTransitionsOnYield(css: string): boolean {
  const code = blankCssComments(css);
  for (const m of code.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(",").map((x) => x.trim().replace(/\s+/g, " "));
    const frame = selectors.includes(`html.${DOCK_YIELD_CLASS} .mobile-nav-frame`);
    const all = selectors.includes(`html.${DOCK_YIELD_CLASS} .mobile-nav-frame *`);
    if (frame && all && /(^|;|\s)transition(-property)?\s*:\s*none\b/.test(m[2])) return true;
  }
  return false;
}

const ALL: BottomBar[] = FILES.flatMap((f) => inventory(f, readFileSync(resolve(ROOT, f), "utf8")));

describe("no fixed bottom bar can render under the dock (Q1646)", () => {
  it("inventories the shipped source and finds the bars", () => {
    expect(FILES.length).toBeGreaterThan(500);
    // SaveBar, BulkDismissBar, the dock, plus the three exceptions, at least.
    expect(ALL.length).toBeGreaterThan(5);
    expect(ALL.some((b) => b.file === "src/components/profile/profileEditForm/SaveBar.tsx")).toBe(true);
    expect(ALL.some((b) => b.file === "src/components/MobileNav.tsx")).toBe(true);
  });

  it("the stylesheet makes the dock yield under html.dock-yield", () => {
    expect(cssHidesDockOnYield(CSS), `src/index.css has no \`html.${DOCK_YIELD_CLASS} .mobile-nav-frame { visibility: hidden }\``).toBe(true);
  });

  it("no transition inside the dock can delay its hide (WebKit glyphs over Save Changes)", () => {
    expect(DOCK_FILES.length).toBeGreaterThan(5);
    const hits = DOCK_FILES.flatMap((f) =>
      transitionsCoveringVisibility(readFileSync(resolve(ROOT, f), "utf8")).map((h) => `${f}: ${h}`),
    );
    // The Icon and the UserAvatar glyphs carry `transition-all` today.
    expect(hits.length, "inventory found no dock transition covering visibility: re-check the scanner").toBeGreaterThan(1);
    expect(
      cssStopsTransitionsOnYield(CSS),
      `src/index.css must set \`transition: none\` on \`html.${DOCK_YIELD_CLASS} .mobile-nav-frame\` and its \`*\` descendants; these dock elements would otherwise stay painted while it yields:\n${hits.join("\n")}`,
    ).toBe(true);
  });

  it("each fixed bottom bar clears the dock, makes it yield, is the dock, or is an exact exception", () => {
    const yieldOk = cssHidesDockOnYield(CSS);
    const unexplained: Record<string, number> = {};
    const offenders: string[] = [];
    for (const b of ALL) {
      if (b.classText.split(/\s+/).includes("mobile-nav-frame")) continue;
      if (clearsTheDock(b)) continue;
      const fileSrc = blankComments(readFileSync(resolve(ROOT, b.file), "utf8"));
      if (yieldOk && /\buseDockYield\s*\(/.test(fileSrc)) continue;
      unexplained[b.file] = (unexplained[b.file] ?? 0) + 1;
      if (!EXACT_EXCEPTIONS[b.file]) offenders.push(`${b.file}:${b.line} [${b.classText}] bottom=${b.styleBottom ?? "(class)"}`);
    }
    expect(
      offenders,
      "a fixed bottom bar can render under the dock: float it on `bottom-safe-nav` / var(--bottom-nav-h, 96px), or call useDockYield while it shows",
    ).toEqual([]);
    for (const [f, { count }] of Object.entries(EXACT_EXCEPTIONS)) {
      expect(unexplained[f] ?? 0, `stale fixed-bottom-bar exception ${f}: set it to ${unexplained[f] ?? 0}`).toBe(count);
    }
  });

  it("useDockYield holds the class while any holder is active", () => {
    const Holder = ({ on }: { on: boolean }) => {
      useDockYield(on);
      return null;
    };
    const cls = document.documentElement.classList;
    const a = render(createElement(Holder, { on: true }));
    const b = render(createElement(Holder, { on: true }));
    expect(cls.contains(DOCK_YIELD_CLASS)).toBe(true);
    act(() => a.rerender(createElement(Holder, { on: false })));
    expect(cls.contains(DOCK_YIELD_CLASS), "one holder let go while another still shows").toBe(true);
    b.unmount();
    expect(cls.contains(DOCK_YIELD_CLASS)).toBe(false);
    a.unmount();
    expect(cls.contains(DOCK_YIELD_CLASS)).toBe(false);
  });
});
