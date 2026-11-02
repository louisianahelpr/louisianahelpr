/**
 * A3-85 (owner 11-01 12:19 PM, narrowed by the lead 6:12 PM): needs-you deadline reminders. A member with a step due
 * gets a push, and a text if opted in, before the deadline: answer a Declutter offer or refund step (new sweep), check
 * out, hand over, approve finished work (existing reminders, now texted). Behaviour, quiet hours, the 2-a-day cap, "never
 * after the step is done" and the stale-text drop are proved in src/test/pglite/needsYouDeadlineReminders.pglite.mjs
 * (31 PASS; 3/31 with NEW_MIGRATION=skip; red on planted defects). These are the source anchors on the NEWEST
 * definitions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { SMS_KIND_PHRASES, buildSmsBody, smsLinkPath } from "../../supabase/functions/_shared/smsPolicy";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

/** Newest migration body that (re)defines `fn`, any dollar-quote tag, comments blanked. */
function newestFunctionBody(fn: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\1`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) body = m[2];
  }
  return body.replace(/\s+/g, " ");
}

function newestTrigger(name: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let stmt = "";
  const re = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) stmt = m[0];
  }
  return stmt.replace(/\s+/g, " ");
}

/** The newest migration that (re)schedules the book-by job (A3-57's 20261102011547 restates its wrapper, not the job). */
function newestScheduling(job: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let sql = "";
  for (const f of files) {
    const s = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    if (s.includes(`cron.schedule('${job}'`)) sql = s;
  }
  return sql;
}

describe("needs-you deadline reminders (A3-85)", () => {
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |      WHERE o.status = 'open' AND o.awaiting IN ('seller', 'buyer') |      WHERE o.awaiting IN ('seller', 'buyer')
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |        AND ((q.status = 'open' AND q.answer_by > p_now | AND ((q.answer_by > p_now
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |                       AND s.sent_at >= v_day_start) >= 2; |                       AND s.sent_at >= v_day_start) >= 3;
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |   IF public.needs_you_reminder_quiet(p_now) THEN\n    RETURN 0; |   IF false THEN\n    RETURN 0;
  it("the sweep reminds only while the step is open and before its deadline, 2 a day per item, never in quiet hours", () => {
    const body = newestFunctionBody("sweep_needs_you_reminders");
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toContain("IF public.needs_you_reminder_quiet(p_now) THEN RETURN 0;");
    expect(body).toContain("WHERE o.status = 'open' AND o.awaiting IN ('seller', 'buyer')");
    expect(body).toContain("o.respond_by > p_now");
    expect(body).toContain("(q.status = 'open' AND q.answer_by > p_now");
    expect(body).toContain("(q.status = 'offered' AND q.offer_answer_by > p_now");
    expect(body).toMatch(/AND s\.sent_at >= v_day_start\) >= 2;/);
    expect(body).toContain("COALESCE(o.is_seed, false) = false");
    expect(body).toContain("COALESCE(q.is_seed, false) = false");
    const quiet = newestFunctionBody("needs_you_reminder_quiet");
    expect(quiet).toContain(">= time '20:50'");
    expect(quiet).toContain("< time '08:00'");
  });

  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |     WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you' |     WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours') THEN 'needs_you'
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |     WHEN p_type = 'warning' AND p_title = 'Please review the work' THEN 'needs_you' |     WHEN p_type = 'warning' AND p_title = 'Please review the work' THEN 'job_update'
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |                      'declutter_offers', 'declutter_refunds', 'declutter_pickups')) |                      'declutter_refunds', 'declutter_pickups'))
  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |       OR (r.kind = 'needs_you' AND n.created_at < v_now - interval '1 hour') |       OR false
  it("every needs-you notice is texted as 'needs_you', the trigger wakes for its types, and a late text is dropped", () => {
    const kind = newestFunctionBody("sms_kind_for");
    expect(kind).toContain("WHEN p_type = 'warning' AND p_title = 'Please review the work' THEN 'needs_you'");
    expect(kind).toContain("WHEN p_type = 'payment' AND p_title IN ('Check out within 24 hours', '2 hours left to check out') THEN 'needs_you'");
    expect(kind).toContain("p_title IN ('Porch pickup in 1 hour', 'Pickup in 1 hour') OR p_title LIKE 'Porch pickup at %' OR p_title LIKE 'Pickup at %') THEN 'needs_you'");
    expect(kind).toContain("WHEN p_type = 'declutter_offers' AND p_title IN ('Answer the offer', 'Offer closes soon') THEN 'needs_you'");
    // Every title the sweep writes is one the classifier texts.
    const sweep = newestFunctionBody("sweep_needs_you_reminders");
    const titles = [...sweep.matchAll(/THEN '([A-Z][^']+)' ELSE '([A-Z][^']+)' END;/g)].flatMap((m) => [m[1], m[2]]);
    expect(titles.length).toBe(6);
    for (const t of titles) expect(kind, t).toContain(`'${t}'`);
    const trg = newestTrigger("notifications_fan_out_to_sms");
    for (const t of ["declutter_offers", "declutter_refunds", "declutter_pickups", "payment", "warning"]) expect(trg).toContain(`'${t}'`);
    const claim = newestFunctionBody("sms_claim_due");
    expect(claim).toContain("OR (r.kind = 'needs_you' AND n.created_at < v_now - interval '1 hour')");
  });

  // @mutate supabase/functions/_shared/smsPolicy.ts |   if (kind === "needs_you") return "/declutter"; |   if (kind === "needs_you") return "/jobs";
  it("the text: a fixed phrase, the job link for a job step, Declutter for the rest, one segment", () => {
    expect(SMS_KIND_PHRASES.needs_you).toBe("Something needs you before a deadline.");
    expect(smsLinkPath("needs_you", null)).toBe("/declutter");
    const job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(smsLinkPath("needs_you", job)).toBe(`/jobs?job=${job}`);
    const t = buildSmsBody({ kind: "needs_you", jobId: job, firstText: true, appUrl: "https://www.louisianahelpr.com" });
    expect(t.length).toBeLessThanOrEqual(160);
  });

  // @mutate supabase/migrations/20261102002011_needs_you_deadline_reminders.sql |       $c$SELECT public.cron_record_work('declutter-book-by-reminders', to_jsonb(public.sweep_deadline_reminders()));$c$); |       $c$SELECT public.cron_record_work('declutter-book-by-reminders', to_jsonb(public.declutter_book_by_reminder_sweep()));$c$);
  it("the cron runs both deadline sweeps on the book-by job's existing line", () => {
    const sql = newestScheduling("declutter-book-by-reminders");
    expect(sql).toContain("PERFORM cron.schedule('declutter-book-by-reminders', '2-59/10 * * * *',");
    expect(sql).toContain("to_jsonb(public.sweep_deadline_reminders())");
    const wrap = newestFunctionBody("sweep_deadline_reminders");
    expect(wrap).toContain("v_book_by := public.declutter_book_by_reminder_sweep(p_now);");
    expect(wrap).toContain("v_needs_you := public.sweep_needs_you_reminders(p_now);");
  });
});
