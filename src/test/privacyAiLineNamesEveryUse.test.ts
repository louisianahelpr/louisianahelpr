/**
 * Q2308 (owner-approved Declutter terms, 2026-10-22): the Privacy tab's AI line (Google Gemini then; Anthropic
 * (Claude) since the owner removed Gemini, 2026-10-22) named only the AI
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
// A source file calls the AI provider when one of its https URL literals has exactly this hostname (parsed with
// URL, never a substring or regex match: code scanning js/incomplete-url-substring-sanitization, 2026-10-21).
const AI_HOSTNAME = "api.anthropic.com";
// ...or imports the shared Claude caller, which holds the one URL literal.
const importsClaude = (code: string): boolean => /from\s+["'](?:\.\.\/)+_shared\/claudeMessages\.ts["']/.test(code);
const callsAi = (code: string): boolean => importsClaude(code) ||
  [...code.matchAll(/["'`](https:\/\/[^"'`\s]+)["'`]/g)].some((m) => {
    try {
      return new URL(m[1]).hostname === AI_HOSTNAME;
    } catch {
      return false;
    }
  });

/** Edge function -> the words its use must have in the AI line. */
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

describe("the Privacy tab's AI line covers every use of the AI provider", () => {
  const callers = [
    ...new Set(
      walk(FUNCTIONS)
        .filter((f) => callsAi(blankComments(readFileSync(f, "utf8"))))
        .map((f) => f.slice(FUNCTIONS.length + 1).split("/")[0]),
    ),
  ].sort();
  const privacy = readFileSync(join(ROOT, "src/pages/info/legal/PrivacySection.tsx"), "utf8");
  const line = privacy.split("\n").find((l) => l.includes(">Anthropic (Claude)<")) ?? "";

  it("finds the AI callers and the line", () => {
    expect(callers.length).toBeGreaterThan(1);
    expect(line).not.toBe("");
  });

  it("every caller is known and its words are in the line", () => {
    const unknown = callers.filter((c) => !(c in USE_WORDS) && c !== "_shared");
    expect(unknown, "a new AI caller: add what it sends to the Privacy tab's AI line and to USE_WORDS").toEqual([]);
    for (const c of callers.filter((x) => x in USE_WORDS)) {
      for (const w of USE_WORDS[c]) expect(line, `${c}: the AI line must say "${w}"`).toContain(w);
    }
  });
});
