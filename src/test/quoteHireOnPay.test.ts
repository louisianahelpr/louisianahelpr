/**
 * Quotes on jobs, owner answers 8-11 (2026-10-17, docs/specs/owner-questions-hub-1015.md
 * "OWNER ANSWERS"), pinned on the NEWEST definition of each function:
 *
 *   8   paying for an agreed quote hires the quoter with no extra Accept tap:
 *       trg_quote_job_funded_hires_quoter (AFTER UPDATE OF payment_status ON
 *       jobs) completes the accept through complete_direct_offer_accept, the one
 *       completion a direct offer uses, or remembers it in job_accept_pending;
 *       it acts only on the step into funded (a redelivered webhook is a no-op)
 *       and never rolls back the payment write.
 *   9   quotes close 2 hours before the job starts (create_quote_request caps
 *       the window there; respond_to_job_quote refuses to agree past it).
 *   10  a new quote and a counter are emailed as well as pushed; the alert
 *       sweep claims each reminder / close notice by its marker column and is
 *       scheduled (pg_cron 'quote-alerts').
 *   11  cancelling an agreed request before paying deletes the job, only when
 *       it never held money.
 *
 * Behaviour: src/test/pglite/quoteHireOnPay.pglite.mjs (after, applied 3x:
 * 12/12; --before on main's quotes migration: 10 behaviour checks FAIL, the 2
 * controls hold; eight planted defects each RED, recorded in the lane report).
 *
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |      OR public.job_payment_is_funded(OLD.payment_status::text) THEN |      OR false THEN
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |       v_done := public.complete_direct_offer_accept(NEW.id, v_quoter); |       v_done := NULL;
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |   AFTER UPDATE OF payment_status ON public.jobs | AFTER UPDATE OF status ON public.jobs
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |         DELETE FROM public.jobs j\n         WHERE j.id = v_req.job_id | DELETE FROM public.jobs j\n         WHERE false AND j.id = v_req.job_id
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |            AND j.stripe_session_id IS NULL AND j.stripe_payment_intent_id IS NULL; |            AND j.stripe_session_id IS NULL;
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql |       AND q.reminder_sent_for IS DISTINCT FROM q.respond_until\n | \n
 * @mutate supabase/migrations/20261017045002_quote_hire_on_pay_alerts.sql | '".', v_uid, true); | '".', v_uid, false);
 * @mutate supabase/migrations/20261015091114_job_quotes.sql |   v_close := LEAST(now() + make_interval(hours => v_window), v_start - interval '2 hours'); |   v_close := now() + make_interval(hours => v_window);
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const root = resolve(__dirname, "../..");
const DIR = resolve(root, "supabase/migrations");
const EFFECTIVE = effectiveDefs(DIR);
const ws = (s: string) => s.replace(/\s+/g, " ");
const body = (fn: string) => {
  const stmt = EFFECTIVE.get(fn)?.stmt;
  expect(stmt, `${fn} has a definition`).toBeTruthy();
  return ws(blankSqlComments(stmt ?? ""));
};
const allSql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => blankSqlComments(readFileSync(resolve(DIR, f), "utf8")))
  .join("\n");

describe("quotes: owner answers 8-11", () => {
  it("reads real definitions (cannot pass vacuously)", () => {
    for (const fn of ["create_quote_request", "respond_to_job_quote", "submit_job_quote", "cancel_quote_request",
      "quote_job_funded_hires_quoter", "quote_notify_about", "sweep_quote_alerts"]) {
      expect(body(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("9: quotes close 2 hours before the job starts, and nothing is agreed past that", () => {
    expect(body("create_quote_request")).toContain(
      "v_close := LEAST(now() + make_interval(hours => v_window), v_start - interval '2 hours');",
    );
    expect(body("respond_to_job_quote")).toMatch(
      /IF p_action <> 'decline' AND \(\(v_req\.date_needed \+ COALESCE\(v_req\.start_time, '23:59'::time\)\) AT TIME ZONE 'America\/Chicago'\) - interval '2 hours' <= now\(\) THEN RAISE EXCEPTION 'job_start_too_soon'/,
    );
  });

  it("8: the step into funded hires the quoter through the direct-offer completion", () => {
    const triggers = [...allSql.matchAll(/CREATE\s+TRIGGER\s+trg_quote_job_funded_hires_quoter\s+([\s\S]*?);/gi)];
    expect(triggers.length).toBeGreaterThan(0);
    expect(ws(triggers[triggers.length - 1][1])).toBe(
      "AFTER UPDATE OF payment_status ON public.jobs FOR EACH ROW WHEN (NEW.offered_to_helper_id IS NOT NULL AND NEW.helper_id IS NULL) EXECUTE FUNCTION public.quote_job_funded_hires_quoter()",
    );
    const b = body("quote_job_funded_hires_quoter");
    // Only the transition: a redelivered escrow write (funded -> funded) does nothing.
    expect(b).toContain(
      "IF NOT public.job_payment_is_funded(NEW.payment_status::text) OR public.job_payment_is_funded(OLD.payment_status::text) THEN RETURN NULL;",
    );
    // Only the quoter who won the agreed quote, on the still-pending offer.
    expect(b).toContain("WHERE r.job_id = NEW.id AND r.status = 'agreed';");
    expect(b).toContain("IF NOT FOUND OR v_quoter IS DISTINCT FROM NEW.offered_to_helper_id THEN RETURN NULL;");
    // The existing completion, or the existing wait for payout setup / ID.
    expect(b).toContain("v_done := public.complete_direct_offer_accept(NEW.id, v_quoter);");
    expect(b).toMatch(/INSERT INTO public\.job_accept_pending \(job_id, helper_id\) VALUES \(NEW\.id, v_quoter\) ON CONFLICT \(job_id\) DO NOTHING;/);
    // A failure never rolls back the payment write, and is recorded.
    expect(b).toMatch(/EXCEPTION WHEN OTHERS THEN v_done := NULL;/);
    expect(b).toMatch(/IF v_done IS NULL THEN .*INSERT INTO public\.error_logs/);
    // No second payment path: the trigger reads no Stripe column and writes none.
    expect(b).not.toMatch(/stripe_|payment_status\s*=/);
  });

  it("11: cancelling an agreed request deletes its job only when it never held money", () => {
    const b = body("cancel_quote_request");
    expect(b).toContain("FROM public.jobs j WHERE j.id = v_req.job_id FOR UPDATE;");
    expect(b).toMatch(
      /DELETE FROM public\.jobs j WHERE j\.id = v_req\.job_id AND j\.status = 'open' AND j\.helper_id IS NULL AND COALESCE\(j\.payment_status, 'unpaid'\) IN \('unpaid', 'abandoned'\) AND j\.stripe_session_id IS NULL AND j\.stripe_payment_intent_id IS NULL;/,
    );
    // A funded job is still refused before anything is deleted.
    expect(b.indexOf("RAISE EXCEPTION 'request_booked'")).toBeLessThan(b.indexOf("DELETE FROM public.jobs"));
  });

  it("10: a new quote and a counter are emailed; the sweep claims each send once and is scheduled", () => {
    expect(body("submit_job_quote")).toMatch(/PERFORM public\.quote_notify_about\(v_req\.poster_id, 'New quote', .*, v_uid, true\);/);
    expect(body("respond_to_job_quote")).toMatch(/PERFORM public\.quote_notify_about\(v_other, 'New counter-offer', .*, v_uid, true\);/);
    const n = body("quote_notify_about");
    expect(n).toMatch(/RETURNING id, link INTO v_id, v_link; IF v_id IS NULL OR NOT COALESCE\(p_email, false\) THEN RETURN;/);
    expect(n).toContain("'/functions/v1/send-notification-email'");
    const s = body("sweep_quote_alerts");
    expect(s).toContain("SET reminder_sent_for = q.respond_until");
    expect(s).toContain("AND q.reminder_sent_for IS DISTINCT FROM q.respond_until");
    expect(s).toContain("SET close_notice_sent_at = now()");
    expect(s).toContain("AND req.close_notice_sent_at IS NULL");
    expect(s.match(/public\.feature_enabled_for_user\('quotes'/g)?.length).toBe(2);
    expect(ws(allSql)).toContain(
      "PERFORM cron.schedule('quote-alerts', '11-59/15 * * * *', $c$SELECT public.cron_record_work('quote-alerts', public.sweep_quote_alerts());$c$);",
    );
  });

  it("the behaviour proof exists", () => {
    expect(existsSync(resolve(root, "src/test/pglite/quoteHireOnPay.pglite.mjs"))).toBe(true);
  });
});
