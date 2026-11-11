/**
 * F435 (whole-app audit 11-10, Worker 5, Low): three "Hallie H. has arrived" notices for different jobs looked the
 * same in the bell. notify_poster_on_status_change now titles an arrival "<job>: <Helpr> has arrived", the job cut
 * to 21 characters and an ellipsis when it is longer than 22 (migration 20261111194335).
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked). Behaviour (real Postgres):
 * src/test/pglite/arrivalNoticeLeadsWithTheJob.pglite.mjs (10 PASS; 4 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111194335_arrival_notice_leads_with_the_job.sql |     v_title := COALESCE(v_title \|\| ': ', '') \|\| v_helper_name \|\| ' has arrived'; |     v_title := v_helper_name \|\| ' has arrived';
 * @mutate supabase/migrations/20261111194335_arrival_notice_leads_with_the_job.sql | THEN rtrim(left(btrim(NEW.title), 21)) \|\| '…' | THEN btrim(NEW.title)
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the arrival notice title leads with the job (F435)", () => {
  it("the arrival branch builds '<job>: <Helpr> has arrived' with a cut job title", () => {
    const b = flat(blankSqlComments(defs.get("notify_poster_on_status_change")?.stmt ?? ""));
    expect(b.length).toBeGreaterThan(2000);
    const start = b.indexOf("ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at");
    const end = b.indexOf("ELSIF NEW.status = 'in_progress'", start);
    expect(start).toBeGreaterThan(-1);
    const arrival = b.slice(start, end);
    expect(arrival).toContain("THEN rtrim(left(btrim(NEW.title), 21)) || '…'");
    expect(arrival).toContain("v_title := COALESCE(v_title || ': ', '') || v_helper_name || ' has arrived';");
    expect(arrival).not.toMatch(/v_title := v_helper_name \|\| ' has arrived';/);
  });
});
