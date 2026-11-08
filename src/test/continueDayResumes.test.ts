/**
 * CONTINUE ANOTHER DAY, FINISHED PROPERLY (owner 11-08, Yusef's job 7b1da54b; every fix of the audit
 * ~/.lh-shots/handoffs-1108/b5-jobs-notify-audit.md picked). Migration 20261108160000.
 *
 * Behaviour (real Postgres): src/test/pglite/continueDayResumes.pglite.mjs (2026-11-08: 39 PASS; 23 FAIL with
 * NEW_MIGRATION=skip; 10 plants each red). The edge half (the hold ends with the day; the lapsed day drives the stalled ladder):
 * src/test/edge/continueDayHold.test.ts and src/test/edge/stalled-completion-reminder.test.ts.
 *
 * This guard holds the CLASS on the effective definitions and the client:
 *   - every notice title a continue-day sender writes is in the email trigger's list (two-way, exact), so a new
 *     continue-day notice cannot be push-only again (F4);
 *   - the poster's status notices never skip the in-app row on a switch (F5), and email marked complete (F6);
 *   - Mark done on a set day needs the new day's photo (Q2), and the tracker runs the new day's steps (F2/F3).
 *
 * @mutate supabase/migrations/20261108160000_continue_day_resumes_checks_in_and_new_photos.sql |           'Your Helpr hasn''t confirmed today', 'Did you finish today?', 'Not marked done yet')) |           'Your Helpr hasn''t confirmed today', 'Did you finish today?'))
 * @mutate supabase/migrations/20261108160000_continue_day_resumes_checks_in_and_new_photos.sql |     UPDATE public.job_continue_days SET done_without_new_photo_at = NEW.helper_completed_at WHERE id = v_id; |     NULL;
 * @mutate supabase/migrations/20261108160000_continue_day_resumes_checks_in_and_new_photos.sql |       v_msg := 'No new photos from ' \|\| to_char(v_moved_day, 'FMDy FMMM/FMDD') \|\| ' — check the work before approving. ' \|\| v_msg; |       NULL;
 * @mutate supabase/migrations/20261108160000_continue_day_resumes_checks_in_and_new_photos.sql |   IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN\n    RETURN NEW;\n  END IF;\n  SELECT c.id, c.new_date | \n  IF public.is_server_context() OR NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN\n    RETURN NEW;\n  END IF;\n  SELECT c.id, c.new_date
 * @mutate supabase/functions/auto-release-payment/index.ts |       if (instantIds.has(job.id) && !job.poster_completed_at && (!noNewPhoto.ok \|\| noNewPhoto.jobs.has(job.id))) { |       if (false) {
 * @mutate src/lib/jobProgressIndex.ts |   const helperArrivedAt = onContinueDay ? null : arrivedStamp; |   const helperArrivedAt = arrivedStamp;
 * @mutate src/lib/jobProgressIndex.ts |     trackingIdx = STATUS_IDX.job_confirmed; |     trackingIdx = STATUS_IDX.done;
 * @mutate src/lib/continueDayWords.ts |   return row?.status === "set" && requirePhotoProof !== false && row.new_after_photo_at === null; |   return false;
 * @mutate src/components/JobTracking.tsx |     onContinueDay: newDay,\n  }); |   });
 * @mutate src/components/JobTrackingView.tsx | \|\| doneTooEarly \|\| doneBeforeContinueDay \|\| doneNeedsNewDayPhoto; | \|\| doneTooEarly \|\| doneBeforeContinueDay;
 * @mutate src/components/statusUpdate.ts |     if (isHelper && newStatus === "working" && !statusTransitioned && !onContinueDay) { |     if (isHelper && newStatus === "working" && !statusTransitioned) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { STATUS_IDX, deriveCurrentStatusIdx } from "@/lib/jobProgressIndex";
import { continueDayOwesAfterPhoto } from "@/lib/continueDayWords";

const MIG_DIR = "supabase/migrations";
const defs = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const FIX = readFileSync(`${MIG_DIR}/20261108160000_continue_day_resumes_checks_in_and_new_photos.sql`, "utf8");
const src = (p: string) => blankComments(readFileSync(p, "utf8"));

/** The continue-day senders: every notice they write is about the day the work moved to. */
const SENDERS = ["propose_job_continue_day", "answer_job_continue_day", "confirm_job_continue_day", "sweep_job_continue_day_reminders"];
/** Title-shaped literals in those bodies that are NOT titles (a name's fallback words). Exact. */
const NOT_TITLES = new Set(["Your Helpr", "The person who posted it", "Your job", "PT404"]);

/** Short capitalised literals with no format placeholder, quote, slash or colon: the notice titles. */
function titleLiterals(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(/'((?:[^']|'')*)'/g)) {
    const t = m[1].replace(/''/g, "'");
    if (/^[A-Z][A-Za-z0-9' ?!]{3,40}$/.test(t) && !/%|"|\/|:/.test(t)) out.add(t);
  }
  return [...out];
}

function emailTriggerTitles(): string[] {
  const when = /CREATE TRIGGER trg_email_continue_day_notice[\s\S]*?NEW\.title IN \(([\s\S]*?)\)\)\s*EXECUTE/.exec(blankSqlComments(FIX))?.[1] ?? "";
  return [...when.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

describe("F4: every continue-day notice emails", () => {
  it("each sender is defined (inventory floor)", () => {
    for (const s of SENDERS) expect(defs.has(s), s).toBe(true);
    expect(emailTriggerTitles().length).toBeGreaterThan(10);
  });

  it("the email trigger's title list is exactly the senders' titles", () => {
    const sent = new Set(SENDERS.flatMap((s) => titleLiterals(body(s))).filter((t) => !NOT_TITLES.has(t)));
    const emailed = new Set(emailTriggerTitles());
    expect([...sent].filter((t) => !emailed.has(t)), "a continue-day notice that would not email").toEqual([]);
    expect([...emailed].filter((t) => !sent.has(t)), "an emailed title no sender writes any more").toEqual([]);
  });
});

describe("F5/F6: the poster's status notices", () => {
  const b = flat(body("notify_poster_on_status_change"));
  it("the in-app row is never skipped on a switch", () => {
    expect(b).toContain("INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);");
    expect(b).not.toContain("preference_off");
  });
  it("on the way / arrived and marked complete email through send_notice_email", () => {
    expect(b).toContain("IF v_category = 'transit_updates' OR (NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL) THEN PERFORM public.send_notice_email(NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);");
  });
});

describe("Q2: Mark done on a set day asks for a photo from that day", () => {
  it("lead 11-08: without one the done is not refused (the 1.0.4 build cannot add it) but MARKED for the poster", () => {
    const r = flat(body("refuse_done_before_continue_day"));
    expect(r).toContain("IF v_id IS NOT NULL AND COALESCE(NEW.require_photo_proof, true) AND v_new_photo IS NULL THEN UPDATE public.job_continue_days SET done_without_new_photo_at = NEW.helper_completed_at WHERE id = v_id;");
    expect(r).not.toContain("continue_day_needs_new_after_photo");
    // Lead re-review 11-08: the mark runs for a server writer too (create-payment 'release' stamps the done as the
    // service role); only the continue_day_ahead refusal is end-user-only.
    expect(r).toContain("IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN RETURN NEW; END IF;");
    expect(r).not.toMatch(/is_server_context\(\) OR NEW\.helper_completed_at IS NULL/);
    expect(r).toContain("IF NOT public.is_server_context() AND v_day IS NOT NULL AND");
    expect(flat(body("notify_poster_on_status_change"))).toContain("v_msg := 'No new photos from ' || to_char(v_moved_day, 'FMDy FMMM/FMDD') || ' — check the work before approving. ' || v_msg;");
  });
  it("the client owes the photo only on a set day, only when photos are needed, only when the server says none yet", () => {
    expect(continueDayOwesAfterPhoto({ status: "set", new_after_photo_at: null }, true)).toBe(true);
    expect(continueDayOwesAfterPhoto({ status: "set", new_after_photo_at: "2026-11-06T21:30:00Z" }, true)).toBe(false);
    expect(continueDayOwesAfterPhoto({ status: "set", new_after_photo_at: null }, false)).toBe(false);
    expect(continueDayOwesAfterPhoto({ status: "proposed", new_after_photo_at: null }, true)).toBe(false);
    // An older read without the column: the server decides (its refusal has its own sentence).
    expect(continueDayOwesAfterPhoto({ status: "set" }, true)).toBe(false);
  });
  it("the tracker greys Mark it done on it, and the card asks for the photo again", () => {
    expect(src("src/components/JobTrackingView.tsx")).toContain("|| doneTooEarly || doneBeforeContinueDay || doneNeedsNewDayPhoto;");
    expect(src("src/pages/jobs/appliedJobCard/steps/HelperPhotoAsk.tsx")).toContain("const afterUrls = owesNewDayAfter ? [] :");
    expect(src("src/pages/jobs/appliedJobCard/ActiveJobSection.tsx")).toContain("!owesNewDayAfter,");
  });
});

describe("F2/F3: the new day runs its own steps", () => {
  // Yusef's job on 11/06: day 1 on the way, arrived, poster confirmed; tracking row still 'done' from day 1.
  const yusef = {
    trackingStatus: "done", jobStatus: "in_progress", helperConfirmedAt: "2026-10-29T23:11:00Z",
    helperDayofConfirmedAt: "2026-11-01T00:08:00Z", posterConfirmedAt: "2026-10-30T00:00:00Z",
    helperOnTheWayAt: "2026-11-01T14:51:41Z", helperArrivedAt: "2026-11-01T15:29:38Z",
    posterConfirmedArrivalAt: "2026-11-01T15:34:59Z", helperCompletedAt: null, posterCompletedAt: null,
  };
  it("before: the rail sat on Done with nothing to press (the bug)", () => {
    expect(deriveCurrentStatusIdx(yusef)).toBe(STATUS_IDX.done);
  });
  it("on the new day the rail is back before On my way, so On my way / I've arrived / Start working come again", () => {
    expect(deriveCurrentStatusIdx({ ...yusef, onContinueDay: true })).toBe(STATUS_IDX.job_confirmed);
    expect(deriveCurrentStatusIdx({ ...yusef, trackingStatus: "on_the_way", onContinueDay: true })).toBe(STATUS_IDX.on_the_way);
    expect(deriveCurrentStatusIdx({ ...yusef, trackingStatus: "working", onContinueDay: true })).toBe(STATUS_IDX.working);
  });
  it("a real completion still reads Done on the new day", () => {
    expect(deriveCurrentStatusIdx({ ...yusef, helperCompletedAt: "2026-11-06T22:00:00Z", onContinueDay: true })).toBe(STATUS_IDX.done);
  });
  it("the server resets the tracker when a day is agreed, and announces the check-ins as job_updates", () => {
    expect(flat(body("continue_day_on_agreed"))).toContain("SET status = 'job_confirmed', updated_at = now() WHERE job_id = NEW.job_id AND status IN ('on_the_way', 'arrived', 'working', 'done');");
    expect(flat(body("continue_day_check_in"))).toContain("VALUES (v_job.customer_id, NEW.job_id, v_title, v_msg, 'job_updates', '/posts?job=' || NEW.job_id::text);");
  });
  it("the client's own 'work started' notice stands down on the new day (the server sends it)", () => {
    expect(src("src/components/statusUpdate.ts")).toContain('if (isHelper && newStatus === "working" && !statusTransitioned && !onContinueDay) {');
  });
});
