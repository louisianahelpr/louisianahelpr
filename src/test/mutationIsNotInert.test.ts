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
function duplicateAttrs(src: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

interface Inert {
  guard: string;
  target: string;
  attr: string;
}

function inertMutations(): Inert[] {
  const out: Inert[] = [];
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
      const before = duplicateAttrs(src, d.target);
      for (const attr of duplicateAttrs(mutated, d.target)) {
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
  });
});

// Proof this is able to fail: the appended-`style` mutation that survived on
// main, restored on the guard it was registered against.
// @mutate e2e/prod-audit/activity-loading-reserve.spec.ts | className="h-[96px] w-16 rounded-ds-md shrink-0 ml-3" | className="h-[26px] w-16 rounded-ds-md shrink-0 ml-3" style={{ height: 96 }}
