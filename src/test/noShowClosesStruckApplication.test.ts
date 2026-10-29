/**
 * A NO-SHOW REPORT CLOSES THE STRUCK HELPR'S APPLICATION (audit 2026-10-29 A2-B14).
 *
 * The bug, measured on prod in the audit (AA9 chunk 1a, aa9-ns-*): report_helper_no_show reopened the job but left
 * the struck Helpr's applications row 'accepted', so his Working tab listed the job under NEEDS YOU with "Accept job
 * / Decline" beside his Final warning. The live body (pg_get_functiondef, 2026-10-29) never touched applications.
 *
 * The fix (20261029154727): in the same transaction as the reopen, accepted -> rejected for THIS job and THIS Helpr,
 * as helper_cancel_booking closes its own. PGlite proof (applied 3x; before: live body leaves 'accepted'; after:
 * 'rejected', the other applicant's pending row and his accepted row on another job untouched, a stranger refused,
 * no anon/PUBLIC grant): ~/.lh-shots/b20-b14/b20-b14-no-show.mjs.
 *
 * The body is read as the migrations leave it (effectiveDefs: the newest CREATE, any dollar-quote tag).
 *
 * @mutate supabase/migrations/20261029180706_application_closed_by_no_show.sql |   UPDATE public.applications\n     SET status = 'rejected',\n         closed_reason = 'no_show'\n   WHERE job_id = p_job_id\n     AND helper_id = v_helper_id | UPDATE public.applications\n     SET status = 'rejected',\n         closed_reason = 'no_show'\n   WHERE false\n     AND helper_id = v_helper_id
 * @mutate supabase/migrations/20261029180706_application_closed_by_no_show.sql |      AND helper_id = v_helper_id\n     AND status = 'accepted'; |      AND status = 'accepted';
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const raw = defs.get("report_helper_no_show")?.stmt ?? "";
const sql = blankSqlComments(raw);

describe("a no-show report closes the struck Helpr's application (A2-B14)", () => {
  it("the inventory is real: the function is defined and the parser found its body", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(sql).toContain("apply_consequence_ladder");
  });

  it("closes exactly this Helpr's accepted application on this job, before the reopen", () => {
    // 20261029180706 adds the reason (closed_reason 'no_show', noShowClosesTheApplication.test.ts).
    const m = sql.match(/UPDATE public\.applications\s+SET status = 'rejected'(?:,\s*closed_reason = '\w+')?\s+WHERE ([^;]*);/);
    expect(m, "an UPDATE public.applications ... SET status = 'rejected'").not.toBeNull();
    const where = m![1].replace(/\s+/g, " ");
    expect(where).toContain("job_id = p_job_id");
    expect(where).toContain("helper_id = v_helper_id");
    expect(where).toContain("status = 'accepted'");
    expect(where).not.toMatch(/\bfalse\b/);
    expect(sql.indexOf(m![0])).toBeLessThan(sql.indexOf("UPDATE public.jobs"));
  });
});
