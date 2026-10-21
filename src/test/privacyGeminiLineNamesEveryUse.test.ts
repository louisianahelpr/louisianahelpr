/**
 * Q2308 (owner-approved Declutter terms, 2026-10-22): the Privacy tab's "Google Gemini" line named only the AI
 * job builder, while supabase/functions/declutter-ai-draft also sends Declutter listing photos and text (and
 * moving-out room photos) to Gemini. privacyPolicyNamesEveryProcessor checks that Gemini is NAMED; this checks
 * that its line says WHAT goes to it, for every edge function that calls the Gemini host (the inventory is read
 * from supabase/functions, comments blanked, never a hand list): each must have its words in the line, and a new
 * caller fails here until the line covers it.
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | , and the photos and words of a Declutter listing (and room photos when you're moving out), to draft and check the listing.</li> | .</li>
 * @mutate src/pages/info/legal/PrivacySection.tsx | the job details you give the AI job builder, to draft your post, | the details you give us,
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");
// The whole origin, as a regex: a source file calls Gemini when it names https://generativelanguage.googleapis.com/
// (a bare host substring check reads as URL sanitizing to code scanning, js/incomplete-url-substring-sanitization).
const GEMINI_ORIGIN = /https:\/\/generativelanguage\.googleapis\.com\//;

/** Edge function -> the words its use must have in the Gemini line. */
const USE_WORDS: Record<string, string[]> = {
  "ai-job-builder": ["AI job builder"],
  "declutter-ai-draft": ["Declutter listing", "room photos"],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|mjs)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("the Privacy tab's Gemini line covers every use of Gemini", () => {
  const callers = [
    ...new Set(
      walk(FUNCTIONS)
        .filter((f) => blankComments(readFileSync(f, "utf8")).match(GEMINI_ORIGIN) !== null)
        .map((f) => f.slice(FUNCTIONS.length + 1).split("/")[0]),
    ),
  ].sort();
  const privacy = readFileSync(join(ROOT, "src/pages/info/legal/PrivacySection.tsx"), "utf8");
  const line = privacy.split("\n").find((l) => l.includes(">Google Gemini<")) ?? "";

  it("finds the Gemini callers and the line", () => {
    expect(callers.length).toBeGreaterThan(1);
    expect(line).not.toBe("");
  });

  it("every caller is known and its words are in the line", () => {
    const unknown = callers.filter((c) => !(c in USE_WORDS) && c !== "_shared");
    expect(unknown, "a new Gemini caller: add what it sends to the Privacy tab's Gemini line and to USE_WORDS").toEqual([]);
    for (const c of callers.filter((x) => x in USE_WORDS)) {
      for (const w of USE_WORDS[c]) expect(line, `${c}: the Gemini line must say "${w}"`).toContain(w);
    }
  });
});
