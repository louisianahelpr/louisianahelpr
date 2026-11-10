/**
 * Whole-app audit 11-10 (Worker 6) F477, migration 20261110224500: the "Still on for tomorrow?" day-of reminder names
 * the job's own day and time ('"<job>" starts Wed, Nov 11 at 9:00 AM — tap to confirm ...') instead of "starts soon",
 * in all four bodies (Helpr, poster, crew member, crew poster). The words come from continue_day_label on
 * jobs.date_needed + start_time (the house date style), or the day alone when the job has no start time.
 * Reads the NEWEST definition of sweep_dayof_confirm_reminders (effectiveDefs), comments blanked.
 *
 * @mutate supabase/migrations/20261110224500_dayof_reminder_names_the_day.sql | starts %s — tap to confirm you''re still on. One tap keeps your spot.', rec.title, v_when), | starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
 * @mutate supabase/migrations/20261110224500_dayof_reminder_names_the_day.sql | ELSE public.continue_day_label(rec.date_needed, rec.start_time) END; | ELSE to_char(rec.date_needed, 'FMDy, FMMon FMDD') END;
 * @mutate supabase/migrations/20261110224500_dayof_reminder_names_the_day.sql | SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at, j.date_needed, j.start_time, | SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at, j.date_needed, NULL::time AS start_time,
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const sweep = blankSqlComments(defs.get("sweep_dayof_confirm_reminders")?.stmt ?? "");

describe("F477: the day-of reminder names the job's day and time", () => {
  it("both reminder passes read the job's date and start time and word them in the house style", () => {
    expect(sweep.length).toBeGreaterThan(200);
    expect(sweep).toContain("SELECT j.id, j.title, j.customer_id, j.helper_id, j.date_needed, j.start_time,");
    expect(sweep).toContain("SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at, j.date_needed, j.start_time,");
    const when =
      /v_when := CASE WHEN rec\.start_time IS NULL THEN to_char\(rec\.date_needed, 'FMDy, FMMon FMDD'\)\s+ELSE public\.continue_day_label\(rec\.date_needed, rec\.start_time\) END;/g;
    expect(sweep.match(when)?.length).toBe(2);
  });

  it("all four 'Still on for tomorrow?' bodies say when the job starts; none says 'starts soon'", () => {
    expect(sweep).not.toContain("starts soon");
    expect(sweep).toContain(`'"%s" starts %s — tap to confirm you''re still on. One tap keeps your spot.', rec.title, v_when),`);
    expect(sweep).toContain(`'"%s" starts %s — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title, v_when),`);
    expect(sweep).toContain(`'"%s" starts %s — tap to confirm you''re still on. One tap keeps your spot on the crew.', rec.title, v_when),`);
    expect(sweep).toContain(`'"%s" starts %s — tap to confirm you''re still on so your crew knows it''s a go.', rec.title, v_when),`);
    expect(sweep.match(/'Still on for tomorrow\?'/g)?.length).toBe(4);
  });

  it("the title the readers key on, the 12-hour alerts and the stamps are unchanged", () => {
    expect(sweep.match(/starts in under 12 hours/g)?.length).toBe(2);
    expect(sweep.match(/UPDATE public\.jobs SET dayof_confirm_reminder_sent_at = NOW\(\)/g)?.length).toBe(2);
    expect(sweep.match(/UPDATE public\.jobs SET dayof_unanswered_poster_alert_sent_at = NOW\(\)/g)?.length).toBe(2);
    // sweep_confirm_reminders_and_repost (20261008205730) finds the day-of reminder by this title.
    expect(blankSqlComments(defs.get("sweep_confirm_reminders_and_repost")?.stmt ?? "")).toContain("'Still on for tomorrow?'");
  });
});
