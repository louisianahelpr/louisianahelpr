/**
 * A job category the client has never heard of must never crash a row.
 *
 * Why this exists (T1, 2026-10-15): twelve trade values were added to the
 * job_category enum while iOS 1.0.4 (build 7119) was in App Review. That build
 * cannot learn the new values, yet it will receive jobs carrying them the
 * moment anyone posts one on the web. Every place 7119 reads a per-category
 * table was checked by hand that day (each falls back: getCategoryIcon ->
 * Briefcase, categoryColors.other, formatCategory, `colors?.dot`). This guard
 * keeps the NEXT build the same, so the next enum value is safe too:
 *
 *   every `<table>[<expression>]` read of a per-category table in non-test
 *   source is either followed by `??` / `||`, read through `?.`, or listed in
 *   GUARDED_LOCALLY with the line that handles the missing case.
 *
 * GUARDED_LOCALLY is exact both ways: a listed site that no longer exists, or
 * whose guard line is gone, fails too.
 */
// @mutate src/components/dashboard/JobCard.tsx | categoryColors[job.category] \|\| categoryColors.other | categoryColors[job.category]
// @mutate src/components/postjob/MaterialsPanel.tsx |   if (!items \|\| items.length === 0) return null; |   if (items.length === 0) return null;
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { walkSource } from "./helpers/walkSource";

const TABLES = new Set([
  "categoryColors",
  "categoryLabels",
  "CATEGORY_ICONS",
  "categoryHues",
  "JOB_CATEGORY_LABELS",
  "categoryPricing",
  "categoryMaterials",
  "categoryTemplates",
  "titlePlaceholders",
]);

/**
 * Sites that read into a local and handle undefined on a later line. Key:
 * "<file>:<table>"; value: a line that must still exist in that file.
 */
const GUARDED_LOCALLY: Record<string, string> = {
  "src/components/postjob/MaterialsPanel.tsx:categoryMaterials": "if (!items || items.length === 0) return null;",
  "src/components/postjob/detailsSection/DescriptionField.tsx:categoryTemplates": "if (!tpl ||",
  "src/lib/pricingGuide.ts:categoryPricing": "if (!pricing) return null;",
  "src/pages/post-job/EntryChoice.tsx:categoryColors": "colors?.dot",
  "src/components/postjob/detailsSection/CategoryPicker.tsx:categoryColors": "colors?.dot",
  // Typed JobCategory, set only from this client's own option list.
  "src/components/profile/savedHelpersTab/useSavedHelpers.ts:JOB_CATEGORY_LABELS": "useState<JobCategory | null>(null)",
  "src/components/profile/SavedHelpersTab.tsx:JOB_CATEGORY_LABELS": "Object.entries(JOB_CATEGORY_LABELS) as [JobCategory, string][]",
  // Iterate the table's OWN keys, so the key always exists.
  "src/lib/jobCategories.ts:JOB_CATEGORY_LABELS": "JOB_CATEGORY_VALUES.map((value) => ({ value, label: JOB_CATEGORY_LABELS[value] }))",
  "src/pages/info/helpCenter/helpCenterContent.ts:JOB_CATEGORY_LABELS": ".filter((value) => CREDENTIAL_TIER_CATEGORIES.has(value))",
  // A different table that shares the name: support-message topics, typed keys.
  "src/components/profile/SupportInline.tsx:CATEGORY_ICONS": "const CATEGORY_ICONS: Record<SupportCategory, React.ReactNode> = {",
};

type Site = { file: string; table: string; line: number; guarded: boolean };

function sites(): Site[] {
  const out: Site[] = [];
  const files = walkSource(["src"], [".ts", ".tsx"]).filter(
    (f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !/(^|\/)test\//.test(relative(process.cwd(), f)),
  );
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (![...TABLES].some((t) => text.includes(`${t}[`))) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (
        ts.isElementAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        TABLES.has(n.expression.text) &&
        !ts.isStringLiteral(n.argumentExpression)
      ) {
        const p = n.parent;
        const isFallbackOp = (b: ts.Node): b is ts.BinaryExpression =>
          ts.isBinaryExpression(b) &&
          (b.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || b.operatorToken.kind === ts.SyntaxKind.BarBarToken);
        const guarded =
          // `a ?? table[x] ?? b`: the read is the right of an inner `??` that is
          // itself the left of an outer one.
          (isFallbackOp(p) && p.right === n && isFallbackOp(p.parent) && p.parent.left === p) ||
          (ts.isBinaryExpression(p) &&
            p.left === n &&
            (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) ||
          ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && !!p.questionDotToken) ||
          // Assignment target or a `?? fallback` one paren up.
          (ts.isParenthesizedExpression(p) && ts.isBinaryExpression(p.parent) && p.parent.left === p &&
            p.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);
        out.push({
          file: relative(process.cwd(), f),
          table: n.expression.text,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          guarded,
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("per-category table reads survive an unknown category", () => {
  const all = sites();

  it("finds a real inventory (floor)", () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it("every unguarded read is a listed local guard", () => {
    const bad = all
      .filter((s) => !s.guarded && !GUARDED_LOCALLY[`${s.file}:${s.table}`])
      .map((s) => `${s.file}:${s.line} reads ${s.table}[...] with no fallback for an unknown category`);
    expect(bad).toEqual([]);
  });

  it("every listed local guard still exists and still has its guard line", () => {
    const unguardedKeys = new Set(all.filter((s) => !s.guarded).map((s) => `${s.file}:${s.table}`));
    const stale: string[] = [];
    for (const [key, line] of Object.entries(GUARDED_LOCALLY)) {
      if (!unguardedKeys.has(key)) stale.push(`${key}: no unguarded read there any more; remove the entry`);
      const file = key.slice(0, key.lastIndexOf(":"));
      if (!readFileSync(file, "utf8").includes(line)) stale.push(`${key}: guard line gone: ${line}`);
    }
    expect(stale).toEqual([]);
  });
});
