/**
 * AUTO-EXPIRE-JOBS RE-OPENS FIRST, THEN CANCELS WHAT IS PAST ITS DATE.
 *
 * Step 2 of supabase/functions/auto-expire-jobs/index.ts cancels every open
 * job whose date has passed. Anything the SAME run re-opens after that read is
 * missed until the next hourly run. expire_unanswered_offers re-opens an
 * unanswered offer at its answer-by, which is capped at the job's start, so on
 * a job dated yesterday it fires exactly at the date rollover and re-opens a
 * past-dated job. It ran after step 2, so such a job sat open + escrow for an
 * hour: listed as open, and holding one of its poster's five open-job slots
 * (enforce_open_job_limit). 2026-10-15 05:00Z it re-opened three funded
 * journey jobs of poster-e2e, which then held 5, and prod-audit's seed at
 * 05:55Z was refused "maximum of 5 open jobs" (run 38689259675). Read live:
 * notifications "Offer expired — job reopened" 05:00:01Z, "Job auto-cancelled"
 * 06:00:01Z, "Refund issued" 06:10Z; again 2026-10-17 05:00:01Z.
 *
 * The class: every write or RPC in auto-expire-jobs that can put a job back to
 * `open` comes before the cancel step's reads.
 *
 * @mutate supabase/functions/auto-expire-jobs/index.ts |     const defects = defectTracker(); |     const defects = defectTracker();\n    const { data: _early } = await supabase.from("jobs").select("id").eq("status", "open").lt("date_needed", today);\n    void _early;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = blankComments(readFileSync(resolve(ROOT, "supabase/functions/auto-expire-jobs/index.ts"), "utf8"));

/** RPCs this function calls that re-open a job (their bodies set status = 'open'). */
const REOPENING_RPCS = ["expire_unanswered_offers"];

describe("auto-expire-jobs re-opens before it cancels past-dated open jobs", () => {
  it("every re-open comes before the first read of past-dated open jobs", () => {
    const firstPastRead = SRC.search(/\.eq\("status", "open"\)[\s\S]{0,120}\.(lt\("date_needed"|lt\("expires_at")/);
    expect(firstPastRead, "the cancel step's read").toBeGreaterThan(0);
    const reopenWrites = [...SRC.matchAll(/\.update\(\{ status: "open"/g)].map((m) => m.index ?? -1);
    const reopenRpcs = REOPENING_RPCS.map((fn) => SRC.indexOf(`supabase.rpc("${fn}")`));
    const reopens = [...reopenWrites, ...reopenRpcs];
    expect(reopens.length).toBeGreaterThan(1);
    for (const at of reopens) {
      expect(at, "a re-open is present").toBeGreaterThan(0);
      expect(at, "re-open after the cancel step's read").toBeLessThan(firstPastRead);
    }
  });

  it("the cancel step still cancels past-dated open jobs", () => {
    expect(SRC).toMatch(/\.eq\("status", "open"\)\s*\.is\("expires_at", null\)\s*\.lt\("date_needed", today\)/);
    expect(SRC).toMatch(/status: "cancelled"/);
  });
});
