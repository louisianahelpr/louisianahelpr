/**
 * TS-012: report intake had no rate limit. The reports_rate_limit BEFORE INSERT
 * trigger caps a reporter at 10 an hour / 30 a day (proven on PGlite 3x) and
 * refuses with 'report_rate_limited'; every client insert into public.reports
 * turns that into copy instead of the generic "try again".
 *
 * @mutate supabase/migrations/20260924061853_reports_per_reporter_rate_limit.sql | IF v_hour >= 10 OR v_day >= 30 THEN  -- TS-012 cap | IF false THEN  -- TS-012 cap
 * @mutate src/components/ReportDialog.tsx | toast.error(reportSubmitError(error, "We couldn't send your report — please try again.")); | toast.error("We couldn't send your report — please try again.");
 * @mutate src/components/profile/SupportInline.tsx | toast.error(reportSubmitError(error, "We couldn't send that — please try again.")); | toast.error("We couldn't send that — please try again.");
 * @mutate src/lib/reportErrors.ts | if (error?.message?.includes("report_rate_limited")) { | if (false) {
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportSubmitError } from "@/lib/reportErrors";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("report intake is rate limited (TS-012)", () => {
  it("the latest migration defining reports_rate_limit still caps per reporter", () => {
    const defs = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
      .filter((s) => /FUNCTION public\.reports_rate_limit\(\)/.test(s));
    const latest = defs.at(-1) ?? "";
    expect(latest).toMatch(/BEFORE INSERT ON public\.reports/);
    expect(latest).toMatch(/IF v_hour >= \d+ OR v_day >= \d+ THEN/);
    expect(latest).toMatch(/RAISE EXCEPTION 'report_rate_limited'/);
  });

  it("every client insert into reports maps the refusal to copy", () => {
    const inserters = walk("src").filter((f) => /from\("reports"\)\s*\.insert\(/.test(readFileSync(f, "utf8")));
    expect(inserters.length).toBeGreaterThanOrEqual(2);
    expect(inserters.filter((f) => !readFileSync(f, "utf8").includes("reportSubmitError(error"))).toEqual([]);
  });

  it("the copy names the limit, anything else keeps the fallback", () => {
    expect(reportSubmitError({ message: "report_rate_limited" }, "fb")).toMatch(/a lot of reports/);
    expect(reportSubmitError({ message: "network" }, "fb")).toBe("fb");
    expect(reportSubmitError(null, "fb")).toBe("fb");
  });
});
