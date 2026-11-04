/*
 * CLASS GUARD: a registered mutation must be one the compiler can SEE.
 *
 * THE DAY THIS COST, 2026-09-21. `activity-loading-reserve.spec.ts` registered
 * a mutation that made the loading placeholder's money bone 96px tall:
 *
 *   className="h-[26px] ... ml-3"  ->  className="h-[26px] ... ml-3" style={{ height: 96 }}
 *
 * The bone ALREADY carried `style={{ background: ... }}`. Two `style` props on
 * one JSX element is a duplicate prop, and React keeps the LAST — so the
 * appended height was discarded before it ever reached the DOM. The source text
 * changed; the rendered box did not. The guard measured 150px mutated and 150px
 * unmutated, and the gate reported it SURVIVED — a red main blaming a guard that
 * was working perfectly well.
 *
 * WHY THIS IS WORTH ITS OWN CHECK RATHER THAN CARE. An inert mutation and a
 * hollow guard produce the IDENTICAL verdict, so the gate cannot tell them
 * apart and the reading it offers ("your guard does not work") points away from
 * the real fault. The cost is paid in the most expensive place available: after
 * a full build and a 28s Playwright run against prod, by whoever next reads a
 * red main. Here it is a string comparison, before anything is built.
 *
 * Deliberately narrow. It asserts ONE thing — that applying the replacement
 * does not leave the same JSX attribute twice on one element — because that is
 * the whole class of mutation the language is guaranteed to ignore. It makes no
 * attempt to judge whether a mutation is *interesting*; only whether it is
 * possible for it to do anything at all.
 */

import { beforeAll, describe, it, expect } from "vitest";
import ts from "typescript";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Loaded by URL at runtime, not by a static specifier, for the same reason
// vacuityGate.test.ts does it: scripts/ sits outside tsconfig.app.json's
// `include`, and a composite project refuses an import resolving outside its
// rootDir. Reading the gate's OWN parser matters more than convenience here —
// a second copy of the directive grammar would eventually disagree with the
// gate about what a registration says, which is the whole bug class.
const url = (f: string) => pathToFileURL(join(process.cwd(), "scripts", "vacuity", f)).href;

interface Mutation {
  guard: string;
  target: string;
  find: string;
  replace: string;
  malformed: boolean;
}
let guardFiles: () => string[];
let parseDirectives: (rel: string) => { mutations: Mutation[] };
let read: (rel: string) => string;
let exists: (rel: string) => boolean;

beforeAll(async () => {
  ({ guardFiles, parseDirectives, read, exists } = await import(/* @vite-ignore */ url("lib.mjs")));
});

/**
 * Duplicate JSX attribute names in `src`, via the TYPESCRIPT PARSER.
 *
 * Hand-rolling this does not work, and the attempt is instructive: scanning
 * back to the nearest `<` cannot tell a JSX tag from a less-than operator, so
 * `if (distanceMiles < 0.1)` reads as a tag with a `distanceMiles` attribute.
 * That version flagged nine mutations and all nine were noise — a guard whose
 * output is entirely false positives is one nobody reads, which is the failure
 * mode this repo has already paid for elsewhere.
 */
function parseTsx(src: string, fileName: string): ts.SourceFile {
  // No parent pointers (Q2704): getText(sf) reads positions only, and setting parents cost a third of the run.
  // JSDoc is never read for JSX attributes, so it is not parsed either.
  return ts.createSourceFile(
    fileName,
    src,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    false,
    ts.ScriptKind.TSX,
  );
}

function duplicateAttrs(src: string, fileName: string): string[] {
  return duplicateAttrsIn(parseTsx(src, fileName));
}

function duplicateAttrsIn(sf: ts.SourceFile): string[] {
  const dupes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const seen = new Set<string>();
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText(sf);
        if (seen.has(name)) dupes.push(name);
        seen.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return dupes;
}

// A literal's text: a string, a template's text part, or JSX text between tags.
const TEXT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);
// Characters that can end, open or escape a literal or a JSX child; a find or replace free of them stays text.
const LITERAL_BREAKERS = /["'`${}<>\\\r\n]/;

/**
 * True when the mutation only rewrites the inside of ONE literal (a class string, a template's text, JSX text) and
 * neither side holds a character that could end or open one: every token of the file, and so every JSX attribute
 * list, is unchanged, so it cannot add a duplicate prop and need not be re-parsed (Q2704: most registered
 * mutations are this shape, and parsing each one timed the coverage run out at 60 s).
 */
function onlyRewritesOneLiteral(sf: ts.SourceFile, start: number, end: number, find: string, replace: string): boolean {
  if (LITERAL_BREAKERS.test(find) || LITERAL_BREAKERS.test(replace)) return false;
  let node: ts.Node = sf;
  for (;;) {
    const child: ts.Node | undefined = ts.forEachChild(node, (c) => (c.getStart(sf) <= start && end <= c.end ? c : undefined));
    if (!child) break;
    node = child;
  }
  return TEXT_KINDS.has(node.kind);
}

/**
 * The duplicate JSX attributes a mutation of [start, end) into `replaceLength` characters can have introduced.
 * Q2704: re-parsing and walking the whole file once per mutation (about 5,500 of them) still timed the coverage run
 * out at 60 s on CI. So only the ONE top-level statement holding the change is re-parsed (a change outside one
 * statement re-parses the whole file), and only the elements whose text overlaps the replaced text are walked:
 * every other element's text is unchanged, so its duplicates are the ones `before` already holds and the caller
 * drops them anyway. (A mutation that unbalances a brace or a quote can make LATER text parse differently; that is a
 * broken source the build reports, not a duplicate prop, and it is not looked for here.)
 */
function duplicateAttrsAfter(
  sf: ts.SourceFile, src: string, mutated: string, start: number, end: number, replaceLength: number, fileName: string,
): string[] {
  const st = sf.statements.find((s) => s.getStart(sf) <= start && end <= s.end);
  const from = st ? st.getStart(sf) : 0;
  const text = st ? mutated.slice(from, st.end + (replaceLength - (end - start))) : mutated;
  const msf = parseTsx(text, fileName);
  const lo = start - from;
  const hi = lo + replaceLength;
  const dupes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.end < lo || node.pos > hi) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const seen = new Set<string>();
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText(msf);
        if (seen.has(name)) dupes.push(name);
        seen.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(msf);
  return dupes;
}

interface Inert {
  guard: string;
  target: string;
  attr: string;
}

function inertMutations(): Inert[] {
  const out: Inert[] = [];
  // Each target's own duplicates are parsed once, not once per mutation on it (Q2704: 5,670 mutations on 864 targets on 2026-11-03).
  const parsedByTarget = new Map<string, { sf: ts.SourceFile; before: string[] }>();
  for (const guard of guardFiles()) {
    for (const d of parseDirectives(guard).mutations) {
      if (d.malformed) continue; // the registration gate's finding, not this one
      if (!/\.[jt]sx$/.test(d.target) || !exists(d.target)) continue;
      const src = read(d.target);
      const at = src.indexOf(d.find);
      if (at === -1) continue; // a stale anchor is the registration gate's finding, not this one
      const mutated = src.slice(0, at) + d.replace + src.slice(at + d.find.length);
      // Only what the MUTATION introduces: a duplicate the file already had is
      // a product bug for someone else to fix, not a broken registration.
      let parsed = parsedByTarget.get(d.target);
      if (!parsed) {
        const sf = parseTsx(src, d.target);
        parsedByTarget.set(d.target, (parsed = { sf, before: duplicateAttrsIn(sf) }));
      }
      if (onlyRewritesOneLiteral(parsed.sf, at, at + d.find.length, d.find, d.replace)) continue;
      const { before } = parsed;
      for (const attr of duplicateAttrsAfter(parsed.sf, src, mutated, at, at + d.find.length, d.replace.length, d.target)) {
        if (before.includes(attr)) continue;
        out.push({ guard: d.guard, target: d.target, attr });
      }
    }
  }
  return out;
}

describe("no registered mutation is inert", () => {
  it("the scan reads real directives (an empty scan passes everything vacuously)", () => {
    const withDirectives = guardFiles().filter((g: string) => parseDirectives(g).mutations.length > 0);
    expect(withDirectives.length, "no guard files carry a @mutate directive").toBeGreaterThan(100);
  });

  it("the duplicate-prop detector actually detects one", () => {
    // The exact shape that survived on main, so this check is shown able to
    // fail without waiting for someone to reintroduce it.
    const tag = `<Skeleton className="h-[26px]" style={{ height: 96 }} style={{ background: "x" }} />`;
    expect(duplicateAttrs(`const x = ${tag};`, "t.tsx")).toEqual(["style"]);
    // And it does not cry wolf on the honest single-prop version.
    expect(
      duplicateAttrs(`const x = <Skeleton className="h-[96px]" style={{ background: "x" }} />;`, "t.tsx"),
    ).toEqual([]);
    // Nor on a less-than operator, which is what defeated the hand-rolled scan.
    expect(duplicateAttrs(`const a = distanceMiles < 0.1 && ok < 2;`, "t.tsx")).toEqual([]);
  });

  // Q2704: the one-statement re-parse finds what the whole-file parse finds, for a change deep inside a component.
  // @mutate src/test/mutationIsNotInert.test.ts |     if (node.end < lo \|\| node.pos > hi) return; |     if (node.end >= lo) return;
  // @mutate src/test/mutationIsNotInert.test.ts | const lo = start - from;\n  const hi | const lo = start;\n  const hi
  it("re-parsing only the changed statement finds the same duplicate prop as the whole file", () => {
    const src = [
      `import x from "y";`,
      `export function A() { return <div className="a" style={{ background: "x" }} />; }`,
      `export const B = () => <span id="b" />;`,
    ].join("\n");
    const find = `className="a"`;
    const replace = `className="a" style={{ height: 96 }}`;
    const at = src.indexOf(find);
    const mutated = src.slice(0, at) + replace + src.slice(at + find.length);
    const sf = parseTsx(src, "t.tsx");
    expect(duplicateAttrs(mutated, "t.tsx")).toEqual(["style"]);
    expect(duplicateAttrsAfter(sf, src, mutated, at, at + find.length, replace.length, "t.tsx")).toEqual(["style"]);
    // A change in the last statement, and an honest one that adds no duplicate.
    const at2 = src.indexOf(`id="b"`);
    const m2 = src.slice(0, at2) + `id="b" id="c"` + src.slice(at2 + 6);
    expect(duplicateAttrsAfter(sf, src, m2, at2, at2 + 6, 13, "t.tsx")).toEqual(["id"]);
    const m3 = src.slice(0, at2) + `id="c"` + src.slice(at2 + 6);
    expect(duplicateAttrsAfter(sf, src, m3, at2, at2 + 6, 6, "t.tsx")).toEqual([]);
  });

  it("applying each replacement leaves no duplicate JSX prop", () => {
    const lines = inertMutations().map(
      (m) =>
        `${m.guard} mutates ${m.target} into an element carrying TWO \`${m.attr}\` props — ` +
        `JSX keeps the last, so the mutation changes the source and nothing else.`,
    );
    expect(
      lines,
      "A mutation the compiler discards SURVIVES no matter how good the guard is, and the " +
        "verdict is indistinguishable from a hollow guard — so the red blames the wrong thing.\n\n" +
        "Mutate the existing prop's VALUE instead of appending a second one " +
        '(h-[26px] -> h-[96px], not an appended `style`).\n\n' +
        lines.join("\n"),
    ).toEqual([]);
  }, 60_000); // it parses every registered mutation's target (about 21 s on a loaded runner, 2026-10-27; 12.3 s -> 6.1 s locally after Q2704 parsed each target's own copy once).
});

// Proof this is able to fail: the appended-`style` mutation that survived on
// main, restored on the guard it was registered against. Q833 moved that registration from the old card's money bone to
// the face placeholder's button bone; the inert form is the same (a second prop appended to the bone).
// @mutate e2e/prod-audit/activity-loading-reserve.spec.ts | <Skeleton className={`${B.button} h-[96px]`} /> | <Skeleton className={`${B.button} h-11`} className="h-[96px]" />
