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
 * 15/15; --before on main's quotes migration: 12 behaviour checks FAIL, the 3
 * controls hold; eleven planted defects each RED, recorded in the lane report).
 *
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | OR NOT (OLD.payment_status IS NULL OR OLD.payment_status::text IN ('unpaid', 'failed', 'abandoned')) THEN | OR public.job_payment_is_funded(OLD.payment_status::text) THEN
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql |       v_done := public.complete_direct_offer_accept(NEW.id, v_quoter); |       v_done := NULL;
 * @mutate supabase/migrations/20261018155222_quote_hire_on_pay_alerts.sql |   AFTER UPDATE OF payment_status ON public.jobs | AFTER UPDATE OF status ON public.jobs
 * @mutate supabase/migrations/20261018155222_quote_hire_on_pay_alerts.sql |         DELETE FROM public.jobs j\n         WHERE j.id = v_req.job_id | DELETE FROM public.jobs j\n         WHERE false AND j.id = v_req.job_id
 * @mutate supabase/migrations/20261018155222_quote_hire_on_pay_alerts.sql |            AND j.stripe_session_id IS NULL AND j.stripe_payment_intent_id IS NULL; |            AND j.stripe_session_id IS NULL;
 * @mutate supabase/migrations/20261023120308_quote_reminders_by_email.sql |       AND q.reminder_sent_for IS DISTINCT FROM q.respond_until\n | \n
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | ' for "' \|\| v_req.title \|\| '".', v_uid, true, | ' for "' \|\| v_req.title \|\| '".', v_uid, false,
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql |     v_reason := public.direct_accept_block_reason(NEW.id, v_quoter); |     v_reason := NULL;
 * @mutate supabase/migrations/20261018155222_quote_hire_on_pay_alerts.sql | WHERE j.id = v_req.job_id AND j.customer_id = v_uid\n | WHERE j.id = v_req.job_id\n
 * @mutate supabase/migrations/20261021112534_block_closes_agreed_unbooked_quote.sql |   AFTER INSERT ON public.user_blocks | AFTER INSERT ON public.job_quotes
 * @mutate supabase/migrations/20261021112534_block_closes_agreed_unbooked_quote.sql |          OR (r.poster_id = NEW.blocked_id AND q.quoter_id = NEW.blocker_id)); |          OR false);
 * @mutate supabase/migrations/20261021112534_block_closes_agreed_unbooked_quote.sql |   EXCEPTION WHEN OTHERS THEN\n    BEGIN\n      INSERT INTO public.error_logs (severity, message, tags, context)\n      VALUES ('error', 'Pending quotes | EXCEPTION WHEN unique_violation THEN\n    BEGIN\n      INSERT INTO public.error_logs (severity, message, tags, context)\n      VALUES ('error', 'Pending quotes
 * @mutate supabase/migrations/20261101180708_direct_offer_notice_next_step.sql |      AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id)\n |      AND true\n
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql |         IF FOUND AND NOT public.are_users_blocked(v_quoter, NEW.customer_id) THEN | IF FOUND THEN
 * @mutate supabase/migrations/20261018155222_quote_hire_on_pay_alerts.sql |        AND q.quoter_id = p_helper\n |        AND true\n
 * @mutate supabase/migrations/20261021112534_block_closes_agreed_unbooked_quote.sql |        WHERE r.status = 'agreed'\n |        WHERE r.status = 'open'\n
 * @mutate supabase/migrations/20261019005719_quote_cap_live_requests.sql |   v_close := LEAST(now() + make_interval(hours => v_window), v_start - interval '2 hours'); |   v_close := now() + make_interval(hours => v_window);
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
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
      "quote_job_funded_hires_quoter", "quote_notify_to", "sweep_quote_alerts", "notify_helper_on_direct_offer"]) {
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
    // ... and only the FIRST funding: a cancel / chargeback put back to escrow never hires.
    expect(b).toContain(
      "IF NOT public.job_payment_is_funded(NEW.payment_status::text) OR NOT (OLD.payment_status IS NULL OR OLD.payment_status::text IN ('unpaid', 'failed', 'abandoned')) THEN RETURN NULL;",
    );
    // Everything the completion would refuse is checked before the setup wait
    // (no "you're booked" across a block), and a lapsed offer is logged.
    expect(b.indexOf("v_reason := public.direct_accept_block_reason(NEW.id, v_quoter);")).toBeGreaterThan(0);
    expect(b.indexOf("v_reason := public.direct_accept_block_reason(NEW.id, v_quoter);")).toBeLessThan(
      b.indexOf("INSERT INTO public.job_accept_pending"),
    );
    expect(b).toContain("v_reason := 'offer_not_pending:'");
    // Only the quoter who won the agreed quote, on the still-pending offer.
    expect(b).toContain("IF NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id) THEN RETURN NULL; END IF; v_quoter := NEW.offered_to_helper_id;");
    expect(body("quote_job_offered_to_quoter")).toContain(
      "SELECT p_helper IS NOT NULL AND EXISTS ( SELECT 1 FROM public.job_quote_requests r JOIN public.job_quotes q ON q.request_id = r.id AND q.status = 'accepted' WHERE r.job_id = p_job_id AND r.status = 'agreed' AND q.quoter_id = p_helper );",
    );
    // Train J sends the direct-offer notice on the same funding UPDATE: the
    // newest notify_helper_on_direct_offer stands aside for exactly the jobs
    // this trigger hires for (one notice, never one across a block), and a
    // completion that THREW tells the quoter to accept by hand, never across a
    // block, only on a live pending offer (lh-money-escrow review of 8ef7cd25b).
    expect(body("notify_helper_on_direct_offer")).toContain(
      "AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id) THEN",
    );
    expect(b).toMatch(
      /IF v_err IS NOT NULL AND v_reason IS NULL THEN BEGIN PERFORM 1 FROM public\.jobs j WHERE j\.id = NEW\.id AND j\.status::text = 'open' AND j\.helper_id IS NULL AND j\.offered_to_helper_id = v_quoter AND j\.direct_offer_status = 'pending' .* FOR SHARE; IF FOUND AND NOT public\.are_users_blocked\(v_quoter, NEW\.customer_id\) THEN PERFORM public\.quote_notify_to\(v_quoter, 'Accept to start', .*, NEW\.customer_id, false, NULL, NEW\.id, false\);/,
    );
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
    expect(b).toContain("FROM public.jobs j WHERE j.id = v_req.job_id AND j.customer_id = v_uid FOR UPDATE;");
    expect(b).toMatch(
      /DELETE FROM public\.jobs j WHERE j\.id = v_req\.job_id AND j\.customer_id = v_uid AND j\.status = 'open' AND j\.helper_id IS NULL AND COALESCE\(j\.payment_status, 'unpaid'\) IN \('unpaid', 'abandoned'\) AND j\.stripe_session_id IS NULL AND j\.stripe_payment_intent_id IS NULL;/,
    );
    // A funded job is still refused before anything is deleted.
    expect(b.indexOf("RAISE EXCEPTION 'request_booked'")).toBeLessThan(b.indexOf("DELETE FROM public.jobs"));
  });

  it("10: a new quote and a counter are emailed; the sweep claims each send once and is scheduled", () => {
    expect(body("submit_job_quote")).toMatch(/PERFORM public\.quote_notify_to\(v_req\.poster_id, 'New quote', .*, v_uid, true, v_req\.id, NULL, false\);/);
    expect(body("respond_to_job_quote")).toMatch(/PERFORM public\.quote_notify_to\(v_other, 'New counter-offer', .*, v_uid, true, v_req\.id, NULL, false\);/);
    const n = body("quote_notify_to");
    expect(n).toMatch(/RETURNING id, link INTO v_id, v_link; IF v_id IS NULL OR NOT COALESCE\(p_email, false\) THEN RETURN;/);
    expect(n).toContain("'/functions/v1/send-notification-email'");
    const s = body("sweep_quote_alerts");
    expect(s).toContain("SET reminder_sent_for = q.respond_until");
    expect(s).toContain("AND q.reminder_sent_for IS DISTINCT FROM q.respond_until");
    expect(s).toContain("SET close_notice_sent_at = now()");
    expect(s).toContain("AND req.close_notice_sent_at IS NULL");
    expect(s.match(/public\.feature_enabled_for_user\('quotes'/g)?.length).toBe(2);
    expect(ws(allSql)).toContain(
      "PERFORM cron.schedule('quote-alerts', '11-59/15 * * * *', $c$SELECT public.cron_record_work('quote-alerts', to_jsonb(public.sweep_quote_alerts()));$c$);",
    );
  });

  // Q1864: a block closes the pair's pending quotes, both ways round, and a
  // failure there never undoes the block.
  it("Q1864: a user_blocks row closes the pair's pending quotes, isolated from the block", () => {
    const triggers = [...allSql.matchAll(/CREATE\s+TRIGGER\s+trg_quote_close_pending_across_block\s+([\s\S]*?);/gi)];
    expect(triggers.length).toBeGreaterThan(0);
    expect(ws(triggers[triggers.length - 1][1])).toBe(
      "AFTER INSERT ON public.user_blocks FOR EACH ROW EXECUTE FUNCTION public.quote_close_pending_across_block()",
    );
    const b = body("quote_close_pending_across_block");
    expect(b).toContain(
      "AND q.status = 'pending' AND ((r.poster_id = NEW.blocker_id AND q.quoter_id = NEW.blocked_id) OR (r.poster_id = NEW.blocked_id AND q.quoter_id = NEW.blocker_id));",
    );
    // Everything the block does sits inside the one guarded block, so a failure never undoes the block.
    expect(b).toMatch(/END LOOP; EXCEPTION WHEN OTHERS THEN BEGIN INSERT INTO public\.error_logs/);
  });

  // Q2122 (owner, 2026-10-21): an accepted quote never booked closes too, and its request is cancelled.
  // Behaviour: src/test/pglite/blockClosesAgreedUnbookedQuote.pglite.mjs.
  it("Q2122: a block also closes an accepted, unbooked quote and cancels its request", () => {
    const b = body("quote_close_pending_across_block");
    expect(b).toContain("WHERE r.status = 'agreed' AND r.job_id IS NULL AND q.status = 'accepted'");
    expect(b).toContain("UPDATE public.job_quote_requests SET status = 'cancelled', updated_at = now() WHERE id = v_request.id AND status = 'agreed' AND job_id IS NULL;");
    expect(existsSync(resolve(root, "src/test/pglite/blockClosesAgreedUnbookedQuote.pglite.mjs"))).toBe(true);
  });

  it("the behaviour proof exists", () => {
    expect(existsSync(resolve(root, "src/test/pglite/quoteHireOnPay.pglite.mjs"))).toBe(true);
  });
});
