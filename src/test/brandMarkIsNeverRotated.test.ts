/*
 * CLASS GUARD: the wrought-iron H is never put under a rotation.
 *
 * Owner, 2026-09-22, on the loading indicator: "I don't like the spinner."
 *
 * The cause was not the speed, which is the reading that kept it alive. The
 * component's own doc argued the point carefully — 1s `animate-spin` felt
 * "impatient and a little cheap", so it used 1.4s — and the slower rotation did
 * not help, because SPEED WAS NEVER THE PROBLEM. This mark is wrought iron with
 * a fleur-de-lis off its centre. A detailed, radially ASYMMETRIC shape cannot
 * rotate cleanly at 20-44px: the ornament smears and the fleur tumbles. Only a
 * symmetric shape (a plain arc, a ring) rotates well. Rendered at 24px it read
 * as cheap at every duration anyone could have chosen.
 *
 * It now breathes instead — upright, opacity 1 -> 0.62 with a 0.94 scale
 * (`mark-breathe`, tailwind.config.ts) — so the mark is legible in every frame.
 *
 * WHY A GUARD AND NOT JUST THE FIX. `animate-spin` is the reflex for "this is
 * loading" and costs one word to type. The next person reaching for a loading
 * state on the brand mark will reach for it, and nothing in the codebase would
 * object; the last attempt to fix this by tuning the duration is evidence that
 * the reasoning does not survive on its own. This fails the moment any file
 * holding the mark also holds a rotation.
 */

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const SRC = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

/** Files that actually render the brand mark, derived — never hand-listed. */
const MARK_FILES = SRC.filter((f) => /helpr-logo-|helprLogo|HelprMark\b/.test(blankComments(read(f))));

/**
 * Any rotation: Tailwind's `animate-spin`, an arbitrary `animate-[spin_…]`,
 * or a raw spin animation shorthand.
 */
const ROTATION = /\banimate-spin\b|\banimate-\[spin[_\s]|animation:[^;"'`]*\bspin\b/;

/**
 * ELEMENT-level, not file-level, and the difference is the whole guard.
 *
 * A file-level scan flagged src/pages/WorkRecord.tsx, which imports HelprMark
 * and — three hundred lines away, on an unrelated control — spins a `Loader2`.
 * That is a lucide icon: a radially SYMMETRIC shape, exactly the thing that is
 * allowed to rotate. Banning rotation in any file that happens to mention the
 * mark would convict correct code, and a guard whose output is false positives
 * is one nobody reads. So this asks the parser which ELEMENT carries the class.
 */
function markElementsWithRotation(file: string): string[] {
  const src = read(file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];

  const isMarkElement = (tag: string, attrs: ts.JsxAttributes): boolean => {
    if (/^HelprMark$/.test(tag)) return true;
    if (tag !== "img") return false;
    // An <img> whose src names a helpr logo import.
    return attrs.properties.some(
      (a) =>
        ts.isJsxAttribute(a) &&
        a.name.getText(sf) === "src" &&
        /helprLogo|helpr-logo-/.test(a.initializer?.getText(sf) ?? ""),
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (isMarkElement(tag, node.attributes)) {
        for (const a of node.attributes.properties) {
          if (!ts.isJsxAttribute(a)) continue;
          if (a.name.getText(sf) !== "className") continue;
          const v = a.initializer?.getText(sf) ?? "";
          if (ROTATION.test(v)) {
            hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.pos).line + 1} <${tag}>`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("the brand mark is never rotated", () => {
  it("the scan found the files that hold the mark (an empty list passes vacuously)", () => {
    expect(MARK_FILES.length, "no file in src/ references the helpr mark").toBeGreaterThanOrEqual(2);
    expect(MARK_FILES).toContain("src/components/ui/HelprSpinner.tsx");
  });

  it("the rotation pattern actually matches the shape it bans", () => {
    expect(ROTATION.test('className="animate-spin"')).toBe(true);
    expect(ROTATION.test('className="motion-safe:animate-[spin_1.4s_linear_infinite]"')).toBe(true);
    expect(ROTATION.test('className="motion-safe:animate-mark-breathe"')).toBe(false);
  });

  it("a rotation on a SYMMETRIC icon in a mark file is allowed", () => {
    // WorkRecord.tsx is the real case: it holds the mark AND spins a Loader2.
    // If this ever reports a hit, the guard has gone back to file-level and
    // will start convicting correct code.
    expect(markElementsWithRotation("src/pages/WorkRecord.tsx")).toEqual([]);
  });

  it("no element rendering the mark applies a rotation", () => {
    const offenders = MARK_FILES.flatMap(markElementsWithRotation);
    expect(
      offenders,
      "The wrought-iron H has a fleur-de-lis off its centre. Rotated at 20-44px its ornament " +
        "smears and the fleur tumbles — it reads as cheap at EVERY duration, which is why " +
        "slowing it from 1s to 1.4s did not fix it (owner, 2026-09-22).\n\n" +
        "For a loading state on the mark use `motion-safe:animate-mark-breathe`. If you need " +
        "something that genuinely rotates, rotate a radially SYMMETRIC shape — a ring or an " +
        "arc — not the mark.",
    ).toEqual([]);
  });
});

// Proof this is able to fail: the exact rotation that was removed, put back on
// the file it was removed from.
// @mutate src/components/ui/HelprSpinner.tsx | className="select-none motion-safe:animate-mark-breathe" | className="select-none motion-safe:animate-[spin_1.4s_linear_infinite]"
