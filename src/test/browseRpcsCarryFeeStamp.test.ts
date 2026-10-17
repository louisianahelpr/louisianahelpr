// Q1839 (lh-money-escrow review of 032657f02, should-fix 1): the browse RPCs
// that return a job's pay inputs (budget, urgent_fee, is_group_job,
// helpers_needed) also return its fee-model stamp, jobs.helper_fee_flat_cents.
// Without it the map pin popup (useMapJobs -> mapJobToEnrichedJob -> JobCard
// -> JobPrice feeStamp={job}) priced a flat-model job at the viewer's tier,
// not 5% + 70c. Built from the migrations' own EFFECTIVE definitions (any
// dollar tag, the newest one, DROPs honoured: effectiveFunctionDefs).
//
// (A) every browse RPC whose RETURNS TABLE carries a pay input also returns
//     helper_fee_flat_cents, and its final SELECT projects it;
// (B) the map adapter carries the stamp onto the card's job;
// (C) the additive change kept the live contract: same arguments, SECURITY
//     DEFINER, STABLE, search_path + TimeZone, and EXECUTE restated for
//     exactly anon, authenticated and service_role (live 2026-10-17); the
//     landing teaser get_public_open_jobs (budget only) is untouched.
// Executed proof: src/test/pglite/browseRpcsFeeStamp.pglite.mjs.
//
// @mutate supabase/migrations/20261017094018_browse_rpcs_carry_fee_stamp.sql | pricing_mode text, distance_band text, helper_fee_flat_cents integer) | pricing_mode text, distance_band text)
// @mutate supabase/migrations/20261017094018_browse_rpcs_carry_fee_stamp.sql |     j.helper_fee_flat_cents\n  FROM public.jobs j |     NULL::integer AS helper_fee_flat_cents\n  FROM public.jobs j
// @mutate supabase/migrations/20261017094018_browse_rpcs_carry_fee_stamp.sql | GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role; | GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO authenticated, service_role;
// @mutate supabase/migrations/20261017094018_browse_rpcs_carry_fee_stamp.sql | COMMENT ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) IS | SELECT 1 AS
// @mutate src/components/browseMap/mapJobToEnrichedJob.ts |     helper_fee_flat_cents: job.helper_fee_flat_cents ?? null, |     helper_fee_percent: null,
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);

const PAY_INPUTS = ["budget", "urgent_fee", "is_group_job", "helpers_needed"];
// The browse surfaces that are functions (open_jobs_browse is a view; its own
// guard is openJobsBrowseStaysDefiner / openJobsBrowseFeeStamp).
const BROWSE_RPCS = ["get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs"];

function returnsTableCols(stmt: string): string[] {
  const m = blankSqlComments(stmt).match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*\n/i);
  return m ? m[1].split(",").map((c) => c.trim().split(/\s+/)[0]) : [];
}

describe("browse RPCs carry the jobs fee-model stamp (Q1839)", () => {
  it("(A) every browse RPC returning a pay input returns helper_fee_flat_cents", () => {
    const paying: string[] = [];
    for (const name of BROWSE_RPCS) {
      const def = DEFS.get(name);
      expect(def, `${name} has a definition in the migrations`).toBeTruthy();
      const cols = returnsTableCols(def!.stmt);
      expect(cols.length, `${name}: RETURNS TABLE parsed`).toBeGreaterThan(5);
      if (!PAY_INPUTS.every((c) => cols.includes(c))) continue;
      paying.push(name);
      expect(cols[cols.length - 1], `${name}: the stamp is the LAST column (additive)`).toBe("helper_fee_flat_cents");
      const body = blankSqlComments(def!.stmt.slice(def!.stmt.indexOf("$function$")));
      // The outer SELECT projects the stamp as its last column, right before
      // its FROM (public.jobs on the map, the scored CTE on the ranked feed).
      expect(body, `${name}: the outer SELECT projects it last`).toMatch(/\n\s*(?:j\.)?helper_fee_flat_cents\s*\n\s*FROM (public\.jobs j|scored)\b/);
    }
    // Inventory floor: the ranked feed and the map both pay-carry.
    expect(paying.sort()).toEqual(["get_open_jobs_for_map", "get_ranked_open_jobs"]);
  });

  it("(B) the map adapter carries the stamp onto the card's job", () => {
    const src = blankComments(readFileSync(path.join(ROOT, "src/components/browseMap/mapJobToEnrichedJob.ts"), "utf8"));
    expect(src).toMatch(/helper_fee_flat_cents:\s*job\.helper_fee_flat_cents\b/);
    const card = blankComments(readFileSync(path.join(ROOT, "src/components/dashboard/JobCard.tsx"), "utf8"));
    expect(card).toMatch(/feeStamp=\{job\}/);
  });

  it("(C) the change kept the live contract and left the landing teaser alone", () => {
    const sql = readFileSync(path.join(MIG, "20261017094018_browse_rpcs_carry_fee_stamp.sql"), "utf8");
    const code = blankSqlComments(sql);
    expect(code).not.toMatch(/get_public_open_jobs/);
    // The view is not redefined, altered or re-granted (the restated COMMENT
    // text names it in prose).
    expect(code).not.toMatch(/\b(?:VIEW|ON)\s+(?:public\.)?open_jobs_browse\b/i);
    // The DROP removes the ranked feed's COMMENT (its security rationale,
    // 20260907052949); the migration restates it (lh-authz-rls review, 4b).
    expect(code).toMatch(/COMMENT ON FUNCTION public\.get_ranked_open_jobs\(integer, integer, boolean, numeric, numeric, numeric\) IS\s+'Public \/jobs feed, ranked\./);
    for (const [name, args] of [
      ["get_ranked_open_jobs", "integer, integer, boolean, numeric, numeric, numeric"],
      ["get_open_jobs_for_map", ""],
    ] as const) {
      const def = DEFS.get(name)!;
      expect(def.file).toBe("20261017094018_browse_rpcs_carry_fee_stamp.sql");
      const head = def.stmt.slice(0, def.stmt.indexOf("$function$"));
      expect(head).toMatch(/LANGUAGE sql\s+STABLE SECURITY DEFINER\s+SET search_path TO 'public'\s+SET "TimeZone" TO 'America\/Chicago'/);
      const fn = `public.${name}(${args})`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(code).toMatch(new RegExp(`DROP FUNCTION IF EXISTS ${fn};`));
      expect(code).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated, service_role;`));
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn} TO anon, authenticated, service_role;`));
    }
  });
});
