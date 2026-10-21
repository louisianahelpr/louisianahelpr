/**
 * Every pop-up hero title (`<DialogHero title=…>`) is SENTENCE CASE: the first
 * word starts with a capital, and every later word is lower case unless it is a
 * proper noun or an acronym (HELPR-DESIGN-SPEC v2 §2, "Sentence case
 * everywhere"; lead 2026-10-21, TRAIN29). It replaces popupTitlesTitleCase,
 * which enforced the older Title Case rule ("Before photos" -> "Before Photos",
 * owner 2026-10-08) that the binding spec has since overturned.
 *
 * Literal strings and the literal words of template strings are read; a `${…}`
 * part is a value (a member's name, a job title, a count) and is skipped. A
 * word after ". ? ! :" starts a new sentence ("Loved it? Share Helpr").
 *
 * @mutate src/components/profile/AvatarCropDialog.tsx | "Position your photo" | "Position Your Photo"
 * @mutate src/components/PhotoProof.tsx | "After"} photos`} | "After"} Photos`}
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["grep", "-l", "<DialogHero", "--", "src"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\./.test(f));

/** Every literal title= on a DialogHero, as written; `${…}` becomes a value marker. */
function titles(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<DialogHero\b([\s\S]*?)\btitle=(\{`([^`]*)`\}|"([^"]*)"|\{"([^"]*)"\})/g)) {
    const raw = m[3] ?? m[4] ?? m[5] ?? "";
    out.push(raw.replace(/\$\{[^}]*\}/g, "\u0001"));
  }
  return out;
}

/** Proper nouns a title may capitalise mid-sentence. */
const PROPER = new Set(["Helpr", "Louisiana", "Stripe", "Apple", "Google", "Pay", "ID"]);
/** An acronym or code: two or more capitals/digits, hyphens allowed (W-9, 2FA, SMS). */
const ACRONYM = /^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/;

/** The words that break the rule, empty when the title is sentence case. */
function sentenceCaseProblems(title: string): string[] {
  const bad: string[] = [];
  let start = true;
  for (const token of title.split(/\s+/).filter(Boolean)) {
    const word = token.replace(/^["'“(]+/, "").replace(/["'”).,?!:;]+$/, "");
    if (word.includes("\u0001") || !/^[A-Za-z]/.test(word)) {
      start = false;
    } else if (start) {
      if (!/^[A-Z]/.test(word)) bad.push(word);
      start = false;
    } else if (/^[A-Z]/.test(word) && !PROPER.has(word) && !ACRONYM.test(word)) {
      bad.push(word);
    }
    if (/[.?!:]["'”)]*$/.test(token)) start = true;
  }
  return bad;
}

describe("every pop-up title is sentence case", () => {
  const all = files.flatMap((f) => titles(readFileSync(f, "utf8")).map((t) => ({ f, t })));

  it("reads every real title (exact inventory, both ways)", () => {
    // 59 on 2026-10-21 (builder1g, TRAIN29). A new DialogHero title raises it,
    // a deleted one lowers it, in the same commit.
    expect(all.length).toBe(59);
  });

  it("the rule itself: catches Title Case and a lower-case start, allows names and acronyms", () => {
    expect(sentenceCaseProblems("Position Your Photo")).toEqual(["Your", "Photo"]);
    expect(sentenceCaseProblems("delete this note?")).toEqual(["delete"]);
    expect(sentenceCaseProblems("Loved it? Share Helpr")).toEqual([]);
    expect(sentenceCaseProblems("Sign your W-9")).toEqual([]);
    expect(sentenceCaseProblems("Happy birthday, \u0001")).toEqual([]);
  });

  it("no title breaks sentence case", () => {
    const bad = all
      .map(({ f, t }) => ({ f, t, words: sentenceCaseProblems(t) }))
      .filter((x) => x.words.length > 0)
      .map(({ f, t, words }) => `${f}: "${t.split("\u0001").join("${…}").trim()}" (${words.join(", ")})`);
    expect(bad).toEqual([]);
  });
});
