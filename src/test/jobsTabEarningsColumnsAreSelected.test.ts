/**
 * Q759 — JobsTab.calcEarning() (src/components/admin/userDetail/JobsTab.tsx)
 * divides a group job's budget by `j.helpers_needed`. Until this fix,
 * useOpenProfile.ts's `jobs` select for the admin Jobs tab did not include
 * `helpers_needed`, so it was always `undefined` at runtime — `calcEarning`
 * fell back to `helpers = 1` and credited a group-job helper the FULL budget
 * instead of their per-helper share.
 *
 * THE CLASS: any column `calcEarning` reads off a job row that is missing
 * from the `.select()` that populates `AdminProfileJob` in
 * src/components/admin/adminusers/useOpenProfile.ts. This guard extracts
 * both sets from source and fails if a column calcEarning reads is absent
 * from the select — in either direction of drift (a new field read by the
 * calc, or a column trimmed from the select).
 *
 * Proven able to fail: dropping `helpers_needed` from the select string
 * reproduces the exact Q759 defect (see the RED test below).
 */
// @mutate src/components/admin/adminusers/useOpenProfile.ts | poster_completed_at, helper_completed_at, parish, helpers_needed | poster_completed_at, helper_completed_at, parish
// @mutate src/components/admin/adminusers/useOpenProfile.ts | budget, helper_fee_percent, helper_fee_flat_cents, customer_fee_amount | budget, helper_fee_percent, customer_fee_amount
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const JOBS_TAB = join(ROOT, "src/components/admin/userDetail/JobsTab.tsx");
const OPEN_PROFILE = join(ROOT, "src/components/admin/adminusers/useOpenProfile.ts");
const HELPER_EARNINGS = join(ROOT, "src/lib/helperEarnings.ts");
// The fee-model module helperEarnings.ts hands the job to (isFlatFeeJob,
// helprFlatFeeCents, flatFeePercentOf). Not followed before Q1839, so the
// flat-fee stamp jobs.helper_fee_flat_cents never counted as a column the
// take-home chain reads, and the Jobs tab select went without it.
const HELPR_FLAT_FEE = join(ROOT, "src/lib/helprFlatFee.ts");

/**
 * Every `<param>.<column>` read inside the exported function `name` of
 * helperEarnings.ts or helprFlatFee.ts, or [] if none — following the job into
 * every other function of those modules it is passed to, at whatever argument
 * position (helperTakeHomeDollars → helperPlatformFeeDollars →
 * helperShareCount / isSettledForDisplay / isFlatFeeJob / helprFlatFeeCents),
 * so a caller of the top-level helper needs every column the chain reads
 * (Q765, Q1839). `job?.col` counts as a read.
 */
export function helperColumns(
  name: string,
  source = readFileSync(HELPER_EARNINGS, "utf8") + "\n" + readFileSync(HELPR_FLAT_FEE, "utf8"),
  seen: Set<string> = new Set(),
  paramIndex = 0,
): string[] {
  const key = `${name}#${paramIndex}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const sf = ts.createSourceFile(HELPER_EARNINGS, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cols = new Set<string>();
  sf.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== name || !node.body) return;
    const param = node.parameters[paramIndex];
    if (!param || !ts.isIdentifier(param.name)) return;
    const p = param.name.text;
    const walk = (n: ts.Node) => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === p) cols.add(n.name.text);
      // `job!.col` (a non-null assertion) is a read of the same column.
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isNonNullExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === p
      ) cols.add(n.name.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        n.arguments.forEach((a, i) => {
          if (ts.isIdentifier(a) && a.text === p) {
            for (const c of helperColumns((n.expression as ts.Identifier).text, source, seen, i)) cols.add(c);
          }
        });
      }
      ts.forEachChild(n, walk);
    };
    walk(node.body);
  });
  return [...cols];
}

/** Every `j.<column>` read inside the `calcEarning` arrow function's body, including through a helperEarnings.ts helper it passes `j` to. */
export function calcEarningColumns(source: string): string[] {
  const sf = ts.createSourceFile(JOBS_TAB, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cols = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "calcEarning" &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      const param = node.initializer.parameters[0];
      const paramName = param && ts.isIdentifier(param.name) ? param.name.text : "j";
      const walk = (n: ts.Node) => {
        if (
          ts.isPropertyAccessExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === paramName
        ) {
          cols.add(n.name.text);
        }
        // A job passed whole to a helperEarnings.ts helper (e.g.
        // helperShareCount(j)) needs every column that helper reads.
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.arguments.some((a) => ts.isIdentifier(a) && a.text === paramName)
        ) {
          for (const c of helperColumns(n.expression.text)) cols.add(c);
        }
        ts.forEachChild(n, walk);
      };
      walk(node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...cols];
}

/** The plain comma-separated column list of the `.select()` that populates AdminProfileJob (the one carrying `helper_completed_at`, a marker unique to that query). */
export function jobsSelectColumns(source: string): string[] {
  const match = source.match(/\.select\("([^"]*helper_completed_at[^"]*)"\)/);
  if (!match) return [];
  return match[1].split(",").map((c) => c.trim()).filter(Boolean);
}

describe("admin Jobs-tab earnings columns are all selected (Q759)", () => {
  const jobsTabSrc = readFileSync(JOBS_TAB, "utf8");
  const openProfileSrc = readFileSync(OPEN_PROFILE, "utf8");
  const earningsCols = calcEarningColumns(jobsTabSrc);
  const selectCols = jobsSelectColumns(openProfileSrc);

  it("inventories calcEarning's own column reads (a broken extractor must not pass vacuously)", () => {
    expect(earningsCols.length).toBeGreaterThan(4);
    expect(earningsCols).toContain("helpers_needed");
    expect(earningsCols).toContain("helper_fee_percent");
    expect(earningsCols).toContain("is_group_job");
    // Reached only through helperTakeHomeDollars' call chain (Q765).
    expect(earningsCols).toContain("urgent_fee");
    expect(earningsCols).toContain("platform_fee_amount");
    expect(earningsCols).toContain("payment_status");
    // Reached only through helprFlatFee.ts's isFlatFeeJob (Q1839).
    expect(earningsCols).toContain("helper_fee_flat_cents");
  });

  it("inventories the jobs select for AdminProfileJob (a broken extractor must not pass vacuously)", () => {
    expect(selectCols.length).toBeGreaterThan(10);
    expect(selectCols).toContain("helper_completed_at");
  });

  it("every column calcEarning reads off a job is present in the select", () => {
    const missing = earningsCols.filter((c) => !selectCols.includes(c));
    expect(missing).toEqual([]);
  });

  it("RED on the exact Q759 defect: helpers_needed dropped from the select", () => {
    const broken = jobsSelectColumns(openProfileSrc.replace(
      /helper_completed_at, parish, helpers_needed/,
      "helper_completed_at, parish",
    ));
    const missing = earningsCols.filter((c) => !broken.includes(c));
    expect(missing).toEqual(["helpers_needed"]);
  });

  it("RED when is_group_job is dropped from the select (the split gate helperShareCount reads)", () => {
    const broken = jobsSelectColumns(openProfileSrc.replace(/, is_group_job\b/, ""));
    const missing = earningsCols.filter((c) => !broken.includes(c));
    expect(missing).toEqual(["is_group_job"]);
  });
});
