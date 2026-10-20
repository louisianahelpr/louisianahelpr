import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

/**
 * OWNER OVERRIDE 2026-10-20 (design spec v2 §2, "sentence case everywhere,
 * form labels included"): Post a Job labels are SENTENCE case ("Job title",
 * "Street address", "Mark as urgent"). This guard used to enforce the opposite
 * (VN-48, owner 2026-09-14: Title Case labels); the 10-20 decision replaces it.
 * Capitalised words allowed after the first: proper nouns (PROPER below) and
 * acronyms (ZIP, HVAC).
 *
 * Inventory from source: every <Label>…</Label> and every toggle title (the
 * `text-ds-13 font-semibold text-foreground` span a Switch sits beside) in
 * the post-job flow. Static text only — `{expressions}` are skipped, and
 * placeholders / helper sentences are not labels, so they are not checked.
 */
// @mutate src/components/postjob/LogisticsSection.tsx | >Street address</Label> | >Street Address</Label>
const ROOTS = ["src/components/postjob", "src/pages/post-job"];
/** Proper nouns that keep their capital mid-label. */
const PROPER = new Set(["Helpr", "Helprs", "Helpr's", "Louisiana", "I", "I'll", "I'm"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

/** Visible static text of a JSX fragment: drop comments, expressions and tags. */
function staticText(jsx: string): string {
  return jsx
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sentenceCaseViolations(text: string): string[] {
  const words = text.split(" ").filter(Boolean);
  return words.filter((raw, i) => {
    const w = raw.replace(/^[("'“]+|[)"'”?:,.*]+$/g, "");
    if (i === 0 || !/^[A-Z]/.test(w)) return false; // first word, lower case, digit, symbol
    if (PROPER.has(w)) return false;
    if (w.length > 1 && w === w.toUpperCase()) return false; // ZIP, HVAC, LA
    return true;
  });
}

function collectLabels(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of ROOTS.flatMap(walk)) {
    // Comments first: several explain <Label> behaviour in prose.
    const src = blankComments(readFileSync(file, "utf8"));
    const patterns = [
      /<Label\b[^>]*>([\s\S]*?)<\/Label>/g,
      /<span className="text-ds-13 font-semibold text-foreground">([^<{]+)<\/span>/g,
    ];
    for (const rx of patterns) {
      for (const m of src.matchAll(rx)) {
        const text = staticText(m[1]);
        if (text) out.push({ file, text });
      }
    }
  }
  return out;
}

describe("Post a Job labels are sentence case (owner override 2026-10-20)", () => {
  it("the checker itself fails on the old Title Case labels", () => {
    expect(sentenceCaseViolations("Job Title *")).toEqual(["Title"]);
    expect(sentenceCaseViolations("Require Before & After Photos")).toEqual(["Before", "After", "Photos"]);
    expect(sentenceCaseViolations("Photos (Optional, Up to 5)")).not.toEqual([]);
    expect(sentenceCaseViolations("Photos (optional, up to 5)")).toEqual([]);
    expect(sentenceCaseViolations("ZIP code")).toEqual([]);
    expect(sentenceCaseViolations("How many Helprs needed?")).toEqual([]);
  });

  it("finds labels to check", () => {
    expect(collectLabels().length).toBeGreaterThan(15);
  });

  it("every static label in the post-job flow is sentence case", () => {
    const bad = collectLabels()
      .map(({ file, text }) => ({ file, text, words: sentenceCaseViolations(text) }))
      .filter((l) => l.words.length > 0);
    expect(bad).toEqual([]);
  });
});
