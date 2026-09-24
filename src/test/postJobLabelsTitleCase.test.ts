import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * VN-48 (owner, 2026-09-14): Post a Job field labels were sentence case
 * ("Job title", "Street address", "Require before & after photos") while the
 * rest of the app's headings and buttons are Title Case.
 *
 * Inventory from source: every <Label>…</Label> and every toggle title (the
 * `text-ds-13 font-semibold text-foreground` span a Switch sits beside) in
 * the post-job flow. Static text only — `{expressions}` are skipped, and
 * placeholders / helper sentences are not labels, so they are not checked.
 */
// @mutate src/components/postjob/LogisticsSection.tsx | >Street Address</Label> | >Street address</Label>
const ROOTS = ["src/components/postjob", "src/pages/post-job"];
const MINOR = new Set(["a", "an", "the", "and", "or", "nor", "for", "to", "of", "in", "on", "at", "by", "as", "per", "vs"]);

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

export function titleCaseViolations(text: string): string[] {
  const words = text.split(" ").filter(Boolean);
  return words.filter((raw, i) => {
    const w = raw.replace(/^[("'“]+|[)"'”?:,.*]+$/g, "");
    if (!/^[a-z]/.test(w)) return false; // capitalised, digit, symbol
    return i === 0 || !MINOR.has(w);
  });
}

function collectLabels(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of ROOTS.flatMap(walk)) {
    // Comments first: several explain <Label> behaviour in prose.
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

describe("Post a Job labels are Title Case (VN-48)", () => {
  it("the checker itself fails on the original sentence-case labels", () => {
    expect(titleCaseViolations("Job title *")).toEqual(["title"]);
    expect(titleCaseViolations("Require before & after photos")).toEqual(["before", "after", "photos"]);
    expect(titleCaseViolations("Photos (optional, up to 5)")).not.toEqual([]);
    expect(titleCaseViolations("Photos (Optional, Up to 5)")).toEqual([]);
    expect(titleCaseViolations("Mark as Urgent")).toEqual([]);
  });

  it("finds labels to check", () => {
    expect(collectLabels().length).toBeGreaterThan(15);
  });

  it("every static label in the post-job flow is Title Case", () => {
    const bad = collectLabels()
      .map(({ file, text }) => ({ file, text, words: titleCaseViolations(text) }))
      .filter((l) => l.words.length > 0);
    expect(bad).toEqual([]);
  });
});
