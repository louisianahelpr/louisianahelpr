/*
 * GUARD: backfill-job-geocode finishes inside the time pg_net gives it.
 *
 * THE BUG (ops ledger 13662001, measured 2026-10-02): error_logs at 00:30:00Z
 * "Timeout of 90000 ms reached ... 89960 ms"; the 04:17Z run took 88,731ms.
 * The run did up to 30 serial Nominatim lookups with no per-lookup timeout
 * and no run budget, 1,100ms apart (see supabase/functions/backfill-job-geocode/budget.ts).
 *
 * The timeout is read from the migration that last scheduled the cron, so
 * lowering it there turns this red too.
 *
 * @mutate supabase/functions/backfill-job-geocode/index.ts | signal: AbortSignal.timeout(NOMINATIM_ATTEMPT_MS), | cache: "no-store",
 * @mutate supabase/functions/backfill-job-geocode/index.ts | if (!mayStartLookup(startedAt, Date.now())) break; | if (false) break;
 * @mutate supabase/functions/backfill-job-geocode/budget.ts | export const RUN_BUDGET_MS = 60_000; | export const RUN_BUDGET_MS = 80_000;
 * @mutate supabase/functions/backfill-job-geocode/budget.ts |   return now - startedAt < RUN_BUDGET_MS; |   return true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { httpCronJobs } from "@/test/helpers/cronHttpJobs";
import { blankComments } from "@/test/helpers/blankNonCode";
import {
  mayStartLookup,
  NOMINATIM_ATTEMPT_MS,
  RUN_BUDGET_MS,
  worstCaseRunMs,
} from "../../supabase/functions/backfill-job-geocode/budget";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const FN_DIR = join(ROOT, "supabase", "functions", "backfill-job-geocode");

function pgNetTimeoutMs(): number {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
  const jobs = [...httpCronJobs(files).values()].filter((c) => c.args.includes("functions/v1/backfill-job-geocode"));
  // Inventory floor: exactly one live HTTP cron calls this function.
  expect(jobs.length).toBe(1);
  const ms = /timeout_milliseconds\s*:=\s*(\d+)/.exec(jobs[0].args)?.[1];
  expect(ms, `no timeout_milliseconds in ${jobs[0].file}`).toBeDefined();
  return Number(ms);
}

describe("backfill-job-geocode fits pg_net's timeout", () => {
  const src = blankComments(readFileSync(join(FN_DIR, "index.ts"), "utf8"));

  it("the worst-case run ends before pg_net gives up", () => {
    const timeout = pgNetTimeoutMs();
    expect(timeout).toBeGreaterThan(0);
    expect(worstCaseRunMs()).toBeLessThan(timeout);
  });

  it("every Nominatim lookup carries the per-lookup timeout", () => {
    const fetches = [...src.matchAll(/\bfetch\(/g)].length;
    expect(fetches).toBeGreaterThan(0);
    expect([...src.matchAll(/signal:\s*AbortSignal\.timeout\(NOMINATIM_ATTEMPT_MS\)/g)].length).toBe(fetches);
    expect(NOMINATIM_ATTEMPT_MS).toBeGreaterThan(0);
  });

  it("the batch loop stops at the run budget", () => {
    expect(src).toMatch(/for \(let i = 0; i < batch\.length; i\+\+\) \{\s*if \(!mayStartLookup\(startedAt, Date\.now\(\)\)\) break;/);
    expect(src).toMatch(/const startedAt = Date\.now\(\);\s*try \{/);
    expect(mayStartLookup(0, RUN_BUDGET_MS - 1)).toBe(true);
    expect(mayStartLookup(0, RUN_BUDGET_MS)).toBe(false);
  });
});
