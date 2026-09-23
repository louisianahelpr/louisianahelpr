/*
 * Q257 — ai-job-builder's system prompt had drifted from the app it writes
 * job postings for:
 *   1. No canonical-noun rule: nothing told Gemini to say "Helpr", not
 *      "helper" (docs/archive/FULL-SURFACE-2026-08-31.md #13 — "Its output
 *      says 'reliable helper'; house style is 'Helpr'").
 *   2. Its category list (line ~98) was missing `storm_prep` and `events`,
 *      both real values of the `job_category` Postgres enum and both present
 *      in src/lib/categoryHues.ts, the app's single source of category
 *      identity. A job an AI-built posting picked from the other 10 could
 *      never land in either category.
 *   3. The title instruction told the model to write "max 32 chars" for a
 *      field that HARD REJECTS anything over 32 — asking an LLM to hit an
 *      exact character count is asking it to overshoot by a few on a
 *      meaningful fraction of calls.
 *
 * Source-text guard (no live Gemini call): reads the real function file, the
 * same technique src/test/roleNeutralCopy.test.ts uses for supabase/functions
 * copy. The category check is TWO-WAY against categoryHues.ts, so it fails
 * whichever side drifts next — a category added to the app's palette that the
 * prompt doesn't learn, or a stray category in the prompt that isn't real.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { categoryHues } from "../lib/categoryHues";

const FILE = resolve(__dirname, "../../supabase/functions/ai-job-builder/index.ts");

function extractSystemPrompt(source: string): string {
  const m = source.match(/const systemPrompt = `([\s\S]*?)`;/);
  if (!m) throw new Error("ai-job-builder's systemPrompt template literal was not found — did its shape change?");
  return m[1];
}

/** The comma-separated category list after "A recommended category from:". */
function promptCategoryList(prompt: string): string[] {
  const m = prompt.match(/recommended category from:\s*([a-z_,\s]+)/i);
  if (!m) throw new Error("Could not find the prompt's category list line");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** The tool schema's `enum: [...]` for `category`. */
function toolSchemaCategoryEnum(source: string): string[] {
  const m = source.match(/category:\s*\{[\s\S]*?enum:\s*\[([^\]]+)\]/);
  if (!m) throw new Error("Could not find the tool schema's category enum");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("ai-job-builder system prompt (Q257)", () => {
  const source = readFileSync(FILE, "utf8");
  const prompt = extractSystemPrompt(source);
  const appCategories = Object.keys(categoryHues).sort();

  it("teaches the canonical noun: Helpr, never helper, for the person doing the job", () => {
    expect(prompt, prompt).toMatch(/\bHelpr\b.*never.*\bhelper\b|canonical noun/i);
  });

  it("the title instruction does not tell the model to write to the exact 32-char hard cap", () => {
    const titleLine = prompt.match(/^1\..*$/m)?.[0] ?? "";
    expect(titleLine, titleLine).not.toMatch(/max 32 chars\)/i);
    // Whatever number it recommends aiming for, it must be strictly under 32 —
    // the hard cap the field rejects at, not the target to write to.
    const target = titleLine.match(/(\d+)(?:-(\d+))? characters/);
    expect(target, titleLine).not.toBeNull();
    const high = Number(target?.[2] ?? target?.[1]);
    expect(high).toBeLessThan(32);
  });

  it("the prompt's category list matches src/lib/categoryHues.ts exactly (two-way)", () => {
    expect(promptCategoryList(prompt).sort()).toEqual(appCategories);
  });

  it("the tool schema's category enum matches src/lib/categoryHues.ts exactly (two-way)", () => {
    expect(toolSchemaCategoryEnum(source).sort()).toEqual(appCategories);
  });

  it("fixture: the two-way check can fail when a real category is missing from the prompt", () => {
    expect(promptCategoryList("A recommended category from: cleaning, other\n").sort()).not.toEqual(appCategories);
  });
});
