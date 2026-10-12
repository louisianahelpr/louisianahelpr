/**
 * Q252 (iOS simulator capture, 2026-10-11): at Dynamic Type
 * accessibility-XXXL the job card's address on My Posts wrapped to two lines
 * and both lines were CENTRED, pushed away from the map pin. The address is a
 * <button> (tap expands the card, hold opens the map), and a button centres
 * its text by default; nothing on the button said otherwise. Any long
 * address does the same at the default text size.
 *
 * CLASS (found from source): a <button> whose content can wrap (a child with
 * whitespace-normal or break-words) must say how its lines align (text-left,
 * text-start, text-center, ...). A centred wrap is then a choice someone
 * wrote down, never the user-agent default leaking through.
 *
 * @mutate src/components/job-card/JobCardMetaRow.tsx | px-1 -mx-1 rounded-ds-sm text-left hover:bg- | px-1 -mx-1 rounded-ds-sm hover:bg-
 * @mutate src/components/postjob/detailsSection/CredentialTierSelector.tsx | className={`flex min-h-[52px] w-full min-w-0 flex-col | className={`flex text-center min-h-[52px] w-full min-w-0 flex-col
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const WRAPS = /\b(whitespace-normal|break-words)\b/;
const ALIGNED = /\btext-(left|start|center|right|end)\b/;

/** `file:line` -> { open tag, aligned } for every innermost <button> with wrapping content. */
function wrappingButtons(): Map<string, boolean> {
  const files = execFileSync("git", ["ls-files", "src/**/*.tsx"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/\.test\.tsx$/.test(f));
  const out = new Map<string, boolean>();
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const code = blankComments(src);
    for (const m of code.matchAll(/<button\b/g)) {
      const start = m.index!;
      const close = code.indexOf("</button>", start);
      if (close < 0) continue;
      let depth = 0;
      let end = start + 1;
      for (; end < close; end++) {
        const ch = code[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0 && code[end - 1] !== "=") break;
      }
      const open = code.slice(start, end + 1);
      const inner = code.slice(end + 1, close);
      if (/<button\b/.test(inner) || !WRAPS.test(inner)) continue;
      out.set(`${file}:${src.slice(0, start).split("\n").length}`, ALIGNED.test(open));
    }
  }
  return out;
}

// Buttons whose wrapping text is meant to sit centred and rely on the
// default for it. Keyed by file (line numbers move); exact both ways.
// @two-way src/test/wrappingButtonTextAligns.test.ts:stale KNOWN_DEFAULT_CENTRED entry
const KNOWN_DEFAULT_CENTRED: Record<string, string> = {
  "src/components/postjob/detailsSection/CredentialTierSelector.tsx": "a third-of-a-phone chip: icon over a centred label",
};

describe("a <button> with wrapping text says how its lines align (Q252)", () => {
  const found = wrappingButtons();

  it("finds the buttons from source (inventory floor)", () => {
    expect(found.size).toBeGreaterThan(3);
  });

  it("every one declares a text alignment or is a known centred chip", () => {
    const offenders = [...found]
      .filter(([key, aligned]) => !aligned && !(key.split(":")[0] in KNOWN_DEFAULT_CENTRED))
      .map(([key]) => key);
    expect(offenders, "a <button> whose text can wrap but leaves the alignment to the default (centred)").toEqual([]);
  });

  it("KNOWN_DEFAULT_CENTRED is exact (no stale entry)", () => {
    const stale = Object.keys(KNOWN_DEFAULT_CENTRED).filter(
      (file) => ![...found].some(([key, aligned]) => key.split(":")[0] === file && !aligned),
    );
    expect(stale, "stale KNOWN_DEFAULT_CENTRED entry: remove it").toEqual([]);
  });
});
