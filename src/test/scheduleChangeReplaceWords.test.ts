/**
 * Q2297 (lh-authz-rls review L1 of ready/builder2h-jobs-15, 2026-10-21): when the person asked to move a job answers
 * with "Suggest another time", the original asker read "This replaces their earlier request", but the replaced request
 * was their own. The newest request_job_schedule_change counts the pending rows the person being told asked for,
 * BEFORE closing them, and says "your" for those, "their" otherwise. Behaviour is proved in PGlite:
 * src/test/pglite/scheduleChangeReplaceWords.pglite.mjs (AFTER passes; the live definition, a count after the UPDATE,
 * an always-"your" clause and a missing anon revoke each FAIL).
 *
 * @mutate supabase/migrations/20261102061755_schedule_change_replace_words_your_own.sql |                 WHEN v_replaced_theirs > 0 THEN ' This replaces your earlier request.' |                 WHEN false THEN ' This replaces your earlier request.'
 * @mutate supabase/migrations/20261102061755_schedule_change_replace_words_your_own.sql |    WHERE r.job_id = v_job.id AND r.status = 'pending' AND r.requested_by = v_other; |    WHERE r.job_id = v_job.id AND r.status = 'pending' AND r.requested_by = v_uid;
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const fn = newestFunction("request_job_schedule_change");
const body = blankSqlComments(fn.body);

describe("Q2297: a schedule-change notice says whose request it replaces", () => {
  it("reads the newest definition", () => {
    expect(fn.file).toMatch(/20261102061755_schedule_change_replace_words_your_own\.sql$/);
    expect(body.length).toBeGreaterThan(2000);
  });

  it("counts the told person's own pending request before the UPDATE closes it", () => {
    const count = body.search(/SELECT count\(\*\) INTO v_replaced_theirs\s+FROM public\.job_schedule_change_requests r\s+WHERE r\.job_id = v_job\.id AND r\.status = 'pending' AND r\.requested_by = v_other;/);
    const update = body.indexOf("UPDATE public.job_schedule_change_requests r");
    expect(count).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(count);
  });

  it("says 'your' for the told person's own request and 'their' otherwise", () => {
    expect(body).toMatch(/WHEN v_replaced = 0 THEN ''\s+WHEN v_replaced_theirs > 0 THEN ' This replaces your earlier request\.'\s+ELSE ' This replaces their earlier request\.' END/);
  });
});
