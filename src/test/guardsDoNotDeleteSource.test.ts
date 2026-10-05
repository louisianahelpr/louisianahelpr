/*
 * CLASS CHECK — a guard must not delete the code it is inspecting.
 *
 * FOUND 2026-09-21, by `src/test/edge/sharedImports.test.ts` failing to notice
 * a mutation. That guard catches an edge function calling a `_shared` helper it
 * never imported — the `release-payout`/`postSlackOpsAlert` ReferenceError that
 * reached main in a money path. Removing that import from `release-payout`
 * failed it. Removing the SAME import from `arrival-confirm-reminder`, which
 * also calls the helper, left it green.
 *
 * Its comment stripper was the obvious one-liner: a non-greedy block-comment
 * regex followed by a line-comment regex. A regex does not know it is inside a
 * string, so the `/` + `*` in a URL or a regex literal opens a comment that
 * runs to the next `*` + `/` anywhere later in the file and deletes everything
 * between; the `//` in `https://` eats the rest of its line.
 *
 * Measured, not estimated:
 *   - `arrival-confirm-reminder` lost the `postSlackOpsAlert(` call itself,
 *     which is how this surfaced: deleting its import left the guard green.
 *   - Counting REAL CODE LOST (non-whitespace characters that a string-aware
 *     scanner keeps and the naive chain drops), 157 of 1,054 TS/TSX source
 *     files lose code. `brand-asset/index.ts` loses 98% of its own code,
 *     `charge-recurring-visits` 74%, `src/test/edge/harness.ts` 51%.
 *   - Bytes-removed is the WRONG metric and an earlier pass used it: this repo
 *     writes long header comments, so "90% removed" is usually correct
 *     stripping. 208 is the honest number.
 *
 * A guard scanning a file it has silently emptied finds nothing and reports
 * green, which looks exactly like the code being correct. This is the purest
 * form of the thing the whole burn-down exists to kill.
 *
 * THE RULE: a source-scanning guard uses `src/test/helpers/blankNonCode.ts`
 * (`blankNonCode`, or `blankComments` when it needs string CONTENT such as a
 * table name). Both are single left-to-right scans that know whether they are
 * inside a string, and both BLANK rather than delete, so every offset and line
 * number in the result still matches the input.
 *
 * RATCHET: the list below is the state on 2026-09-21 and may only SHRINK. A new
 * guard cannot join it — that is the point. Each entry is a guard whose real
 * coverage is unknown, because whatever it scanned may have been destroyed
 * before it looked.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankNonCode, blankComments, blankCssComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");

/** Guards still using the deleting idiom. MAY ONLY SHRINK. */
// @two-way src/test/guardsDoNotDeleteSource.test.ts:const stale = GRANDFATHERED.filter
// EMPTY since 2026-10-05 (Q1020): the last 24 were moved onto blankComments /
// blankCssComments, and aasaRouteParity was never a comment stripper (its
// `.replace(/\/\*$/, ...)` turns a path glob into a regex; the detector now
// requires the block-comment body `[\s\S]*?`).
const GRANDFATHERED: readonly string[] = []; // ← do not add to this list

/** The deleting idiom: `.replace(<block-comment regex>, …)`. */
const DELETING_IDIOM = /\.replace\(\s*\/\\\/\\\*\[\\s\\S\]\*\?/;

function sourceScanningGuards(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx", "src/test/helpers/*.ts", "e2e/*.ts"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => f !== "src/test/helpers/blankNonCode.ts");
}

function currentOffenders(): string[] {
  return sourceScanningGuards()
    .filter((f) => {
      let src: string;
      try {
        src = readFileSync(resolve(REPO, f), "utf8");
      } catch {
        return false;
      }
      return DELETING_IDIOM.test(src);
    })
    .sort();
}

describe("no guard deletes the code it inspects", () => {
  const offenders = currentOffenders();

  it("the detector actually matches the idiom (a check that finds nothing cannot fail)", () => {
    // If the pattern above stops matching, every assertion here passes
    // vacuously and the ratchet quietly stops ratcheting.
    const sample = 'const s = src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, " ");';
    expect(DELETING_IDIOM.test(sample)).toBe(true);
    expect(DELETING_IDIOM.test('const s = blankNonCode(src);')).toBe(false);
  });

  it("no NEW guard uses a deleting comment stripper", () => {
    const known = new Set(GRANDFATHERED);
    const added = offenders.filter((f) => !known.has(f));
    expect(
      added,
      "this deletes the code it is about to search. The `/` + `*` inside a URL or regex literal " +
        "opens a comment that runs to the next `*` + `/` anywhere later in the file — repo-wide it " +
        "empties 293 of 1,053 source files by more than 60%, and a guard that scans an emptied file " +
        "reports green. Import blankNonCode (or blankComments) from src/test/helpers/blankNonCode.",
    ).toEqual([]);
  });

  it("the grandfathered list only shrinks", () => {
    const live = new Set(offenders);
    const stale = GRANDFATHERED.filter((f) => !live.has(f));
    expect(
      stale,
      "these no longer use the deleting idiom — remove them from GRANDFATHERED so the ratchet " +
        "records the progress and cannot silently slip back.",
    ).toEqual([]);
  });

  /*
   * THE PROPERTY ITSELF, asserted on the replacement rather than trusted. Both
   * helpers must preserve every byte position on real repo source — that is the
   * whole difference between blanking and deleting, and it is what the old
   * stripper failed.
   */
  it("blankNonCode and blankComments preserve every byte position on real source", () => {
    const damaged: string[] = [];
    const sample = execFileSync("git", ["ls-files", "--", "src/lib/*.ts", "supabase/functions/*/index.ts"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    })
      .split("\n")
      .filter(Boolean);
    for (const f of sample) {
      const raw = readFileSync(resolve(REPO, f), "utf8");
      for (const [name, fn] of [["blankNonCode", blankNonCode], ["blankComments", blankComments]] as const) {
        const out = fn(raw);
        if (out.length !== raw.length || out.split("\n").length !== raw.split("\n").length) {
          damaged.push(`${name} damaged ${f}: ${raw.length} -> ${out.length}`);
        }
      }
    }
    expect(damaged.length, damaged.slice(0, 5).join("; ")).toBe(0);
    expect(sample.length, "the sample must not be empty").toBeGreaterThan(50);
  });

  /*
   * JSX TEXT IS NOT JAVASCRIPT — a scanner can be fooled by prose as easily as
   * a regex is fooled by strings.
   *
   * `IdentityHeader.tsx` has `know who they're hiring` as element text, three
   * lines above a `{/* … *` + `/}` comment mentioning "(#112)". Treating that
   * apostrophe as a string quote made the scan skip to the next apostrophe and
   * swallow the comment, which then read as live code — `alarmColourInvariant`
   * duly reported the issue number as an un-tokenised hex colour. Found
   * 2026-09-21 while migrating that guard off the deleting stripper.
   */
  it("an apostrophe inside a word is prose, not a string quote", () => {
    const jsx = [
      "<p>know who they're hiring</p>",
      "{/" + "* the badge (#112) is a comment *" + "/}",
      'const real = "kept";',
    ].join("\n");
    const out = blankNonCode(jsx);
    expect(out, "the JSX comment must be blanked").not.toContain("#112");
    expect(out, "the prose itself is code text and stays").toContain("they're hiring");
    expect(out, "a real string body is still blanked").not.toContain("kept");
  });

  it("is able to fail: the old idiom really does destroy real source", () => {
    // The concrete file that started this, so the finding cannot become
    // folklore. Reproduces the deleting stripper and measures the damage.
    const raw = readFileSync(resolve(REPO, "supabase/functions/arrival-confirm-reminder/index.ts"), "utf8");
    // The chain exactly as sharedImports.test.ts had it — comments AND the
    // three string forms, all deleting. Built with `new RegExp` so this file
    // does not itself contain the idiom its own ratchet forbids.
    const deleted = raw
      .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), " ")
      .replace(new RegExp("//[^\\n]*", "g"), " ")
      .replace(new RegExp("`(?:\\\\[\\s\\S]|[^\\\\`])*`", "g"), "``")
      .replace(new RegExp('"(?:\\\\[\\s\\S]|[^\\\\"])*"', "g"), '""')
      .replace(new RegExp("'(?:\\\\[\\s\\S]|[^\\\\'])*'", "g"), "''");
    expect(deleted.length).toBeLessThan(raw.length * 0.3); // ~87% gone
    // ...and the call this guard family exists to find vanishes with it.
    const CALL = /(?<![.\w$])postSlackOpsAlert\s*\(/;
    expect(CALL.test(raw)).toBe(true);
    expect(CALL.test(deleted)).toBe(false);
    // The replacement keeps it.
    expect(CALL.test(blankNonCode(raw))).toBe(true);
  });
});

// PROVEN RED 2026-09-21: pointing `blankNonCode` at the deleting implementation
// fails both "preserve every byte position" and "the old idiom really does
// destroy real source". Removing an entry from GRANDFATHERED while the guard
// still uses the idiom fails "no NEW guard uses a deleting comment stripper".
// SOURCE-TEXT PIN: this detects ONE spelling of the mistake — `.replace(` with
// a block-comment regex. A guard that hand-rolls the same deletion another way
// (a split/join, an indexOf loop) is outside its inventory.
// @mutate src/test/helpers/blankNonCode.ts | if (blankStrings) blank(i + 1, j); | if (blankStrings) blank(i + 1, j); out.splice(i, 1);

// Q1020: the CSS scanner the stylesheet guards moved onto.
// @mutate src/test/helpers/blankNonCode.ts |       const stop = end === -1 ? n : end + 2; |       const stop = i + 2;
// @mutate src/test/helpers/blankNonCode.ts |     if (c === '"' \|\| c === "'") { |     if (false) {
describe("blankCssComments (Q1020)", () => {
  it("blanks CSS comments, keeps strings and unquoted urls, and keeps every byte position", () => {
    const css = 'a{b:url(https://x/y.css)} /* {gone} */ c{content:"/* kept */"}\n/* two\nlines */d{}';
    const out = blankCssComments(css);
    expect(out.length).toBe(css.length);
    expect(out.split("\n").length).toBe(css.split("\n").length);
    expect(out).toContain("url(https://x/y.css)");
    expect(out).toContain('"/* kept */"');
    expect(out).not.toContain("{gone}");
    expect(out).not.toContain("two");
    expect(out).toContain("d{}");
  });

  it("on the real stylesheet: same length, same lines, only comment bytes changed (to spaces)", () => {
    const raw = readFileSync(resolve(REPO, "src/index.css"), "utf8");
    const out = blankCssComments(raw);
    expect(raw.length).toBeGreaterThan(10_000);
    expect(out.length).toBe(raw.length);
    expect(out.split("\n").length).toBe(raw.split("\n").length);
    const bad: number[] = [];
    for (let i = 0; i < raw.length; i++) if (out[i] !== raw[i] && out[i] !== " ") bad.push(i);
    expect(bad).toEqual([]);
  });
});
