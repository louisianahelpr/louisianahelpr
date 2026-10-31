/**
 * Q2432 (lead 2026-10-27): both sides of a booked Declutter pickup get one
 * reminder 1 hour before the time (bell + push per settings, and email per
 * settings), once per booked time. Behaviour on real Postgres:
 * src/test/pglite/declutterPickupReminders.pglite.mjs. This file holds the
 * NEWEST definitions (any dollar tag, via effectiveDefs) and the cron.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

// @mutate supabase/migrations/20261027205028_declutter_pickup_reminders.sql |        AND b.slot_start <= now() + interval '60 minutes' |        AND b.slot_start <= now() + interval '6 hours'
// @mutate supabase/migrations/20261027205028_declutter_pickup_reminders.sql |        AND b.reminded_slot_start IS DISTINCT FROM b.slot_start\n |
// @mutate supabase/migrations/20261027205028_declutter_pickup_reminders.sql |    VALUES ('error', 'declutter pickup reminder failed for one booking', |    VALUES ('info', 'declutter pickup reminder failed for one booking',
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |   IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.user_id = p_other AND o.is_seed) |   IF false
// @mutate supabase/migrations/20261027205028_declutter_pickup_reminders.sql |        AND o.status = 'paid'\n |
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |         'type', 'declutter_pickups', 'link', public.declutter_notice_link(p_link)) |         'type', 'system_alert', 'link', public.declutter_notice_link(p_link))
// @mutate supabase/migrations/20261027205028_declutter_pickup_reminders.sql |     PERFORM cron.schedule('declutter-pickup-reminders', '4-59/5 * * * *', |     PERFORM cron.schedule('declutter-pickup-reminders', '0 * * * *',

const ROOT = resolve(__dirname, "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(DIR);
const body = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has no definition`).toBeDefined();
  return { body: blankSqlComments(d!.stmt), file: d!.file };
};

describe("Declutter pickup reminders (Q2432)", () => {
  const sweep = body("declutter_pickup_reminder_sweep");
  const remind = body("declutter_pickup_remind");

  it("reminds only a paid pickup-or-porch sale whose time is within the next hour, once per time", () => {
    for (const clause of [
      "b.slot_start > now()",
      "b.slot_start <= now() + interval '60 minutes'",
      "b.reminded_slot_start IS DISTINCT FROM b.slot_start",
      "o.status = 'paid'",
      "o.handover IN ('pickup_home', 'porch')",
      "FOR UPDATE OF b SKIP LOCKED",
    ]) expect(sweep.body, clause).toContain(clause);
    // Claimed before anything is sent.
    expect(sweep.body.indexOf("SET reminded_slot_start = r.slot_start")).toBeLessThan(sweep.body.indexOf("declutter_pickup_remind(r.buyer_id"));
  });

  // Since 20261028162048 the reminder is its own kind, declutter_pickups: the
  // Declutter "Pickups" switch gates its push and email_declutter_pickups its
  // email (backfilled from the member's email_job_updates).
  it("tells BOTH sides, in the bell (push) and by email under the member's Declutter pickups settings", () => {
    expect((sweep.body.match(/declutter_pickup_remind\(r\.buyer_id/g) ?? []).length).toBe(2);
    expect((sweep.body.match(/declutter_pickup_remind\(r\.seller_id/g) ?? []).length).toBe(2);
    expect(remind.body).toContain("PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);");
    expect(remind.body).toContain("/functions/v1/send-notification-email");
    expect(remind.body).toContain("'type', 'declutter_pickups'");
    // A test side never reaches a real member: not in the bell (declutter_notify) and not by email.
    expect(remind.body).toMatch(/IF EXISTS \(SELECT 1 FROM public\.profiles o WHERE o\.user_id = p_other AND o\.is_seed\)\s+AND NOT EXISTS \(SELECT 1 FROM public\.profiles r WHERE r\.user_id = p_user AND r\.is_seed\) THEN\s+RETURN;/);
  });

  it("never fails silently: one bad booking is logged and retried, an email that cannot be queued is logged", () => {
    expect(sweep.body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs \(severity, message, tags, context\)\s+VALUES \('error', 'declutter pickup reminder failed for one booking'/);
    expect(remind.body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs/);
    expect(remind.body).not.toMatch(/RAISE WARNING/);
  });

  it("runs every 5 minutes and is registered with the cron watch", () => {
    const all = blankSqlComments(readFileSync(join(DIR, sweep.file), "utf8"));
    expect(all).toContain("PERFORM cron.schedule('declutter-pickup-reminders', '4-59/5 * * * *',");
    expect(all).toContain("public.cron_record_work('declutter-pickup-reminders', to_jsonb(public.declutter_pickup_reminder_sweep()))");
    expect(all).toMatch(/INSERT INTO public\.cron_work_expectations[\s\S]*'declutter-pickup-reminders'/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.declutter_pickup_reminder_sweep\(\) FROM PUBLIC, anon, authenticated;/);
  });
});
