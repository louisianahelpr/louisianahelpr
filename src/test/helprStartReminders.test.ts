/**
 * Start reminders for hired Helprs (owner 2026-10-29, Q2483): "Your job starts
 * in 2 hours", "You have a job today" (8 AM Central) and "Time to head out".
 * Behaviour on real Postgres, to the millisecond and across DST:
 * src/test/pglite/helprStartReminders.pglite.mjs. This guard keeps the layers
 * joined, on the definitions the migrations actually leave live:
 * - the sweep's three windows, and the people it reaches;
 * - never two at once: head-out rides on Starting soon while that switch is on,
 *   and the 8 AM one rides on the 2-hour one when that is due now, within 15
 *   minutes or already went out, while the 2-hour switch is on (lead 2026-10-29);
 * - no "starts in 2 hours" to a Helpr whose job is being reposted for a missing
 *   day-of confirm: the sweep's owes_dayof is the repost sweep's own test,
 *   exact both ways, so a change to either one turns this red;
 * - once per job, Helpr and reminder (claim before send), and the log goes with the account;
 * - texts: the 2-hour and head-out ones are as urgent as Starting soon;
 * - the titles match the registry rows that give each its own switch;
 * - service_role only, on the cron, and in the generated types.
 *
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | AND NOT t.owes_dayof THEN 'two_hours' END), | THEN 'two_hours' END),
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | AND t.start_time >= time '10:00' THEN 'morning_of' END), | THEN 'morning_of' END),
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | AND NOT t.left_already THEN 'head_out' END) | THEN 'head_out' END)
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | ELSIF v_kind = 'morning_of' AND rec.two_hours_near THEN | ELSIF v_kind = 'morning_of' AND false THEN
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | SELECT COALESCE((SELECT p.remind_two_hours FROM | SELECT COALESCE((SELECT p.remind_morning_of FROM
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | SELECT COALESCE((SELECT p.remind_starting_soon FROM | SELECT COALESCE((SELECT p.remind_head_out FROM
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | ((v_now >= t.starts_at - interval '135 minutes' | ((v_now >= t.starts_at - interval '120 minutes'
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | AND s2.kind = 'two_hours' AND NOT s2.merged)) | AND s2.kind = 'two_hours' AND false))
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | AND j.is_group_job IS NOT TRUE AND j.parent_job_id IS NULL | AND j.is_group_job IS NOT TRUE
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | ON CONFLICT (job_id, user_id, kind) DO NOTHING; | ;
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | v_message := CASE WHEN rec.owes_dayof | v_message := CASE WHEN false
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE, | user_id uuid NOT NULL,
 * @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql | p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon' | p_title IN ('Your job starts in 2 hours') THEN 'starting_soon'
 * @mutate supabase/migrations/20261030035326_helpr_start_reminders.sql | REVOKE ALL ON FUNCTION public.sweep_helpr_start_reminders(timestamptz) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.sweep_helpr_start_reminders(timestamptz) FROM PUBLIC;
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const defs = effectiveDefs(DIR);
const body = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} is gone`).toBeTruthy();
  return flat(d!.stmt);
};
/** The migrations, comments blanked and whitespace collapsed, oldest first. */
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: flat(readFileSync(`${DIR}/${f}`, "utf8")) }));
/** Split a WHERE-style conjunction (optionally wrapped in one pair of brackets) into its predicates. */
const preds = (s: string) =>
  s
    .trim()
    .replace(/^\(([\s\S]*)\)$/, "$1")
    .split(/\s+AND\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

const TWO = "Your job starts in 2 hours";
const DAY = "You have a job today";
const OUT = "Time to head out";

describe("start reminders for hired Helprs (Q2483)", () => {
  const sweep = body("sweep_helpr_start_reminders");

  it("sends each of the three in its own window, to the people Starting soon reaches", () => {
    const kinds = [...sweep.matchAll(/THEN '(two_hours|morning_of|head_out)' END/g)].map((m) => m[1]);
    // Inventory floor and exact set: three start reminders.
    expect(kinds.length).toBeGreaterThan(2);
    expect(kinds.sort()).toEqual(["head_out", "morning_of", "two_hours"]);
    expect(sweep).toContain(
      "WHEN v_now >= t.starts_at - interval '2 hours' AND v_now < t.starts_at - interval '105 minutes' AND NOT t.owes_dayof THEN 'two_hours' END",
    );
    expect(sweep).toContain(
      "WHEN v_local::date = t.date_needed AND v_local::time >= time '08:00' AND v_local::time < time '09:00' AND t.start_time >= time '10:00' THEN 'morning_of' END",
    );
    expect(sweep).toContain(
      "WHEN v_now >= t.starts_at - interval '30 minutes' AND v_now < t.starts_at AND NOT t.left_already THEN 'head_out' END",
    );
    // Chicago wall clock for the start and for 8 AM.
    expect(sweep).toContain("((h.date_needed + h.start_time) AT TIME ZONE 'America/Chicago') AS starts_at");
    expect(sweep).toContain("v_local timestamp := (COALESCE(p_now, now()) AT TIME ZONE 'America/Chicago')");
    // The current Helpr of an accepted solo job, every current member of an open or accepted crew job.
    expect(sweep).toMatch(/FROM public\.jobs j WHERE j\.status = 'accepted' AND j\.helper_id IS NOT NULL/);
    expect(sweep).toMatch(/JOIN public\.group_job_helpers g ON g\.job_id = j\.id AND g\.helper_id IS NOT NULL WHERE j\.is_group_job IS TRUE AND j\.status IN \('open', 'accepted'\)/);
  });

  it("never sends two at once: head-out rides on Starting soon, the 8 AM one on the 2-hour one", () => {
    expect(sweep).toMatch(
      /IF v_kind = 'head_out' THEN SELECT COALESCE\(\(SELECT p\.remind_starting_soon FROM public\.notification_preferences p WHERE p\.user_id = rec\.user_id\), true\) INTO v_merged;/,
    );
    expect(sweep).toMatch(
      /ELSIF v_kind = 'morning_of' AND rec\.two_hours_near THEN SELECT COALESCE\(\(SELECT p\.remind_two_hours FROM public\.notification_preferences p WHERE p\.user_id = rec\.user_id\), true\) INTO v_merged;/,
    );
    // "Near": due now or within 15 minutes (135 = 120 + one 15-minute 2-hour window), or already sent.
    expect(sweep).toContain(
      "((v_now >= t.starts_at - interval '135 minutes' AND v_now < t.starts_at - interval '105 minutes' AND NOT t.owes_dayof) OR EXISTS (SELECT 1 FROM public.helpr_start_reminder_sends s2 WHERE s2.job_id = t.job_id AND s2.user_id = t.user_id AND s2.kind = 'two_hours' AND NOT s2.merged)) AS two_hours_near",
    );
    // A merged one is claimed (so never sent later) but not written.
    expect(sweep).toMatch(/IF v_claimed = 0 OR v_merged THEN CONTINUE; END IF;/);
  });

  it("skips the 2-hour reminder for exactly the Helprs the repost sweep is about to remove", () => {
    const owes = sweep.slice(sweep.indexOf("AS left_already,") + "AS left_already,".length, sweep.indexOf(") AS owes_dayof") + 1);
    const owesPreds = preds(owes);
    expect(owesPreds.length).toBeGreaterThan(3);

    const repost = body("sweep_confirm_reminders_and_repost");
    const where = repost.slice(repost.indexOf("FROM public.jobs j WHERE ") + "FROM public.jobs j WHERE ".length, repost.indexOf(" FOR UPDATE OF j"));
    const window = "AND (j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago' BETWEEN now() AND now() + interval '24 hours'";
    expect(where, "the repost sweep's 24-hour window moved").toContain(window);
    const repostPreds = preds(where.replace(window, ""));
    // What the sweep's solo branch already requires (and the 2-hour window is inside the 24 hours).
    const soloBranch = ["j.status = 'accepted'", "j.helper_id IS NOT NULL", "j.date_needed IS NOT NULL"];
    for (const p of soloBranch) expect(sweep, `solo branch: ${p}`).toContain(p);
    // Exact both ways: the repost test = owes_dayof + the solo branch.
    expect([...owesPreds].sort()).toEqual(repostPreds.filter((p) => !soloBranch.includes(p)).sort());
    // And it reposts at the same moment the 2-hour reminder opens.
    expect(repost).toContain("IF r.starts_at <= now() + interval '2 hours' THEN");
  });

  it("claims each reminder once per job and Helpr before sending it", () => {
    const claim = sweep.indexOf("INSERT INTO public.helpr_start_reminder_sends (job_id, user_id, kind, merged, sent_at) VALUES (rec.job_id, rec.user_id, v_kind, v_merged, v_now) ON CONFLICT (job_id, user_id, kind) DO NOTHING;");
    const send = sweep.indexOf("INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)");
    expect(claim).toBeGreaterThan(-1);
    expect(send, "the claim comes before the send").toBeGreaterThan(claim);
    expect(sweep).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.helpr_start_reminder_sends s WHERE s\.job_id = t\.job_id AND s\.user_id = t\.user_id AND s\.kind = k\.kind\)/);
    const table = migrations.map((m) => m.sql).join("\n").match(/CREATE TABLE IF NOT EXISTS public\.helpr_start_reminder_sends \(([^;]*)\);/);
    expect(table, "helpr_start_reminder_sends is gone").toBeTruthy();
    expect(table![1]).toContain("PRIMARY KEY (job_id, user_id, kind)");
    // Deleted with the account, like the other reminder logs (data export lists it as exempt for that reason).
    expect(table![1]).toContain("user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE");
  });

  it("texts the 2-hour and head-out ones as Starting soon, the 8 AM one as a job update", () => {
    const kindFor = body("sms_kind_for");
    expect(kindFor).toContain(`WHEN p_type = 'job_update' AND p_title IN ('${TWO}', '${OUT}') THEN 'starting_soon'`);
    expect(kindFor).not.toContain(DAY);
    expect(kindFor).toContain("WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'");
  });

  it("sends the titles the registry gives a switch to, as job_update rows on the job", () => {
    for (const t of [TWO, DAY, OUT]) expect(sweep).toContain(`v_title := '${t}';`);
    // The 8 AM one asks a Helpr who still owes the day-of confirm for it (lead 2026-10-30).
    expect(sweep).toMatch(/v_message := CASE WHEN rec\.owes_dayof THEN format\('You have a job today at %s: "%s"\. Confirm you''ll be there\.'/);
    expect(sweep).toMatch(/VALUES \(rec\.user_id, 'job_update', v_title, v_message, '\/jobs\?job=' \|\| rec\.job_id::text, false, rec\.job_id\)/);
    const reg = migrations.filter((m) => /INSERT INTO public\.job_reminder_types/.test(m.sql)).slice(-1)[0].sql;
    for (const [kind, col, title] of [
      ["two_hours", "remind_two_hours", TWO],
      ["morning_of", "remind_morning_of", DAY],
      ["head_out", "remind_head_out", OUT],
    ]) {
      expect(reg).toMatch(new RegExp(`\\('${kind}', '[^']*', '(?:[^']|'')*', false, '${col}', 'job_update', '${title}', NULL, \\d+\\)`));
    }
  });

  it("is service_role only, runs on the cron, and is in the generated types", () => {
    const all = migrations.map((m) => m.sql).join("\n");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.sweep_helpr_start_reminders(timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(all).toContain("REVOKE ALL ON TABLE public.helpr_start_reminder_sends FROM PUBLIC, anon, authenticated;");
    expect(all).toContain("ALTER TABLE public.helpr_start_reminder_sends ENABLE ROW LEVEL SECURITY;");
    expect(defs.get("sweep_helpr_start_reminders")!.stmt).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(all).toContain(
      "PERFORM cron.schedule('sweep-helpr-start-reminders', '1-59/5 * * * *', $c$SELECT public.cron_record_work('sweep-helpr-start-reminders', to_jsonb(public.sweep_helpr_start_reminders()));$c$);",
    );
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/helpr_start_reminder_sends: \{\s+Row: \{\s+job_id: string\s+kind: string\s+merged: boolean/);
    expect(types).toMatch(/sweep_helpr_start_reminders: \{\s+Args: \{ p_now\?: string \}\s+Returns: number/);
  });
});
