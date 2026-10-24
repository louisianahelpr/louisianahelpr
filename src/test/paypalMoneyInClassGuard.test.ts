/**
 * CLASS GUARD (PayPal Plan A phase 3): money comes IN through PayPal one way only, and
 * "funded" means the money was captured.
 *
 * (a) ONE module moves PayPal money in for a JOB: no source file but
 *     supabase/functions/_shared/payments/paypalJobCheckout.ts calls a job-payment RPC
 *     (paypal_job_order_open / _capture_claim / _capture_record / _capture_failed /
 *     _order_void) or builds a job capture key (lh:job:...:capture). A second,
 *     hand-rolled job capture path is exactly how an order gets captured without the
 *     claim. (Tips and other products own their own orders: pp-tips.)
 * (b) In that module, every capture() call sits after a paypal_job_capture_claim RPC
 *     whose refusal returns, in the same function.
 * (c) Nothing on the job checkout path writes jobs.payment_status itself: only the
 *     paypal_job_capture_record / _failed RPCs do, under the row's lock. (Refunds and
 *     payouts, phases 4-5, own their own writes.)
 * (d) Database, NEWEST definitions (any dollar tag): the claim refuses (and voids) a
 *     closed, already-paid or re-priced job and refuses when the switch is off; the record
 *     funds only a claimed or pending row and reports every other capture as an orphan;
 *     job_is_funded and the award gate both require job_provider_payment_held, which counts
 *     only a captured (or partly refunded) row, never a pending one.
 * (e) Every PayPal SQL function (paypal_% and job_provider_payment_held) is SECURITY
 *     DEFINER with a fixed search_path and is revoked from PUBLIC, anon and authenticated
 *     in its newest migration (job_is_funded keeps its member grant: it gates applying).
 *
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |   if (!claim?.ok) {\n    if (claim?.reason && FUNDED_STATUSES.has(claim.reason)) | if (false) {\n    if (claim?.reason && FUNDED_STATUSES.has(claim.reason))
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   const cancelQuoteRequestId = escrowCancelQuoteRequestId(body.returnPath); |   const cancelQuoteRequestId = escrowCancelQuoteRequestId(body.returnPath); await db.rpc("paypal_job_capture_record", {});
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |       platform_fee_amount: flatFeeCents / 100, |       platform_fee_amount: flatFeeCents / 100, payment_status: "escrow",
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |   ELSIF NOT public.paypal_job_price_matches(v_job, v_row.breakdown) THEN\n    v_reason := 'price_changed'; |   ELSIF false THEN\n    v_reason := 'price_changed';
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |   IF v_row.status IN ('voided', 'failed', 'created') THEN | IF v_row.status IN ('voided', 'failed') THEN
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |     ELSIF v_job.status::text IN ('completed', 'cancelled') THEN\n      v_why := 'orphan:job_closed'; |     ELSIF false THEN\n      v_why := 'orphan:job_closed';
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |                AND p.status IN ('captured', 'partially_refunded'))\n    OR NOT EXISTS |                AND p.status IN ('captured', 'partially_refunded', 'capture_pending'))\n    OR NOT EXISTS
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |   IF NOT (public.job_payment_is_funded(NEW.payment_status) AND public.job_provider_payment_held(NEW.id)) THEN | IF NOT public.job_payment_is_funded(NEW.payment_status) THEN
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |          onboarding_fee_amount = CASE WHEN v_fee_rows = 1 THEN |          onboarding_fee_amount = CASE WHEN v_onboarding > 0 THEN
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql | REVOKE ALL ON FUNCTION public.paypal_job_capture_claim(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.paypal_job_capture_claim(uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261023232151_paypal_job_checkout.sql |   BEFORE UPDATE OF payment_status ON public.jobs\n  FOR EACH ROW EXECUTE FUNCTION public.paypal_job_money_state_guard(); |   BEFORE INSERT ON public.jobs\n  FOR EACH ROW EXECUTE FUNCTION public.paypal_job_money_state_guard();
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = path.resolve(__dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const MODULE = "supabase/functions/_shared/payments/paypalJobCheckout.ts";
const JOB_RPCS = ["paypal_job_order_open", "paypal_job_capture_claim", "paypal_job_capture_record", "paypal_job_capture_failed", "paypal_job_order_void"];
const PAYPAL_LAYER = (f: string) => f.startsWith("supabase/functions/_shared/payments/") || f.startsWith("supabase/functions/paypal-webhook/") || f === "supabase/functions/create-payment/paypalEscrow.ts";
/** The job checkout path (phase 3's files). */
const CHECKOUT_PATH = [MODULE, "supabase/functions/create-payment/paypalEscrow.ts", "supabase/functions/_shared/payments/webhook/checkoutEvents.ts", "supabase/functions/_shared/payments/jobSettleFollowUp.ts"];

const sources = execFileSync("git", ["ls-files", "supabase/functions", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.(ts|tsx)$|\/test\//.test(f));
const code = (f: string) => blankComments(readFileSync(path.join(ROOT, f), "utf8"));
const defs = effectiveDefs(MIG);
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "");

describe("PayPal money in: one path, through the claim", () => {
  it("reads a real inventory (floors)", () => {
    expect(sources.length).toBeGreaterThan(500);
    expect(sources).toContain(MODULE);
    expect(sources.filter(PAYPAL_LAYER).length).toBeGreaterThan(8);
  });

  it("(a) only paypalJobCheckout.ts captures or calls the job-payment RPCs", () => {
    const offenders: string[] = [];
    for (const f of sources) {
      if (f === MODULE) continue;
      const src = code(f);
      if (/lh:job:\$\{[^}]*\}:capture/.test(src)) offenders.push(`${f}: builds a job capture key`);
      for (const rpc of JOB_RPCS) if (new RegExp(`["'\`]${rpc}["'\`]`).test(src)) offenders.push(`${f}: ${rpc}`);
    }
    expect(offenders).toEqual([]);
    const mod = code(MODULE);
    for (const rpc of JOB_RPCS) expect(mod, rpc).toMatch(new RegExp(`"${rpc}"`));
  });

  it("(b) every capture() in the module follows a claim whose refusal returns", () => {
    const mod = code(MODULE);
    const caps = [...mod.matchAll(/ctx\.provider\.capture\(/g)].map((m) => m.index!);
    expect(caps.length).toBeGreaterThan(0);
    for (const at of caps) {
      const fnStart = mod.lastIndexOf("export async function", at);
      const region = mod.slice(fnStart, at);
      const claim = region.lastIndexOf(`"paypal_job_capture_claim"`);
      expect(claim, `capture at ${at} has no claim before it`).toBeGreaterThan(-1);
      expect(region.slice(claim)).toMatch(/if \(!claim\?\.ok\) \{[\s\S]*?return /);
    }
  });

  it("(c) nothing on the job checkout path writes jobs.payment_status itself", () => {
    for (const f of CHECKOUT_PATH) expect(sources, f).toContain(f);
    const writes = CHECKOUT_PATH.filter((f) => /payment_status\s*:/.test(code(f)));
    expect(writes).toEqual([]);
  });
});

describe("PayPal money in: the database decides (newest definitions)", () => {
  it("the claim refuses (and voids) a closed, paid or re-priced job, and refuses with the switch off", () => {
    const b = body("paypal_job_capture_claim");
    expect(b).toMatch(/SECURITY DEFINER/);
    expect(b).toMatch(/FOR UPDATE/);
    expect(b).toMatch(/IF v_row\.status = 'created' AND NOT public\.feature_enabled_for_user\('paypal_payments', v_row\.payer_id\) THEN\s+RETURN jsonb_build_object\('ok', false/);
    // A re-claim (capture retry) re-checks the job too: the job checks come before the already_claimed answer.
    expect(b.indexOf("v_reason := 'job_closed'")).toBeLessThan(b.indexOf("'already_claimed'"));
    expect(b).toMatch(/v_reason := 'setup_fee_already_paid'/);
    expect(b).toMatch(/v_reason := 'job_closed'/);
    expect(b).toMatch(/v_reason := 'job_already_paid'/);
    expect(b).toMatch(/ELSIF NOT public\.paypal_job_price_matches\(v_job, v_row\.breakdown\) THEN\s+v_reason := 'price_changed'/);
    expect(b).toMatch(/IF v_reason IS NOT NULL THEN[\s\S]*?SET status = CASE WHEN v_row\.status = 'created' THEN 'voided' ELSE 'failed' END/);
  });

  it("the record funds only a claimed or pending row; every other capture is an orphan", () => {
    const b = body("paypal_job_capture_record");
    expect(b).toMatch(/IF v_row\.status IN \('voided', 'failed', 'created'\) THEN[\s\S]*?v_why := 'orphan:'/);
    for (const why of ["job_gone", "job_closed", "second_capture", "price_changed"]) expect(b).toMatch(new RegExp(`v_why := 'orphan:${why}'`));
    expect(b).toMatch(/ELSIF v_job\.status::text IN \('completed', 'cancelled'\) THEN\s+v_why := 'orphan:job_closed'/);
    expect(b).toMatch(/ELSIF NOT public\.paypal_job_price_matches\(v_job, v_row\.breakdown\) THEN\s+v_why := 'orphan:price_changed'/);
    expect(b).toMatch(/SET status = 'voided', provider_capture_id = p_capture_id, status_reason = v_why/);
    expect(b).toMatch(/IF p_settled IS NULL OR p_amount_cents IS NULL THEN\s+RAISE EXCEPTION/);
    expect(b).toMatch(/IF p_amount_cents IS DISTINCT FROM v_row\.amount_cents THEN\s+RETURN jsonb_build_object\('outcome', 'amount_mismatch'/);
    expect(b).toMatch(/SET payment_status = 'escrow'/);
  });

  it("funded = captured: job_is_funded and the award gate read job_provider_payment_held, which never counts a pending capture", () => {
    expect(body("job_is_funded")).toMatch(/public\.job_payment_is_funded\(j\.payment_status\) AND public\.job_provider_payment_held\(j\.id\)/);
    expect(body("enforce_job_funded_before_award")).toMatch(/IF NOT \(public\.job_payment_is_funded\(NEW\.payment_status\) AND public\.job_provider_payment_held\(NEW\.id\)\) THEN/);
    const held = body("job_provider_payment_held");
    const statuses = [...held.matchAll(/p\.status IN \(([^)]*)\)/g)].map((m) => m[1]);
    expect(statuses[0]).toBe("'captured', 'partially_refunded'");
    expect(held).not.toMatch(/'capture_pending'/);
  });

  it("a PayPal-funded job's payment state moves only through the PayPal RPCs (the guard trigger and its flag)", () => {
    const g = body("paypal_job_money_state_guard");
    expect(g).toMatch(/current_setting\('app\.paypal_money_write', true\) IS DISTINCT FROM '1'/);
    expect(g).toMatch(/RAISE EXCEPTION 'paypal_job_money_outside_paypal'/);
    expect(g).toMatch(/public\.paypal_job_money_rows_exist\(OLD\.id, ARRAY\['approved', 'capture_pending', 'captured', 'partially_refunded', 'disputed'\]\)/);
    // Both flags are read NULL-safely: an unset setting is NULL, and `NOT (x = '1')` would let it through.
    const lock = body("paypal_capture_locks_job_price");
    expect(lock).toMatch(/current_setting\('app\.paypal_sanctioned_cancel', true\) IS DISTINCT FROM '1'/);
    for (const b of [g, lock]) expect(b).not.toMatch(/NOT \(current_setting/);
    // The setup fee is recorded on the job only when this payment won the claim.
    expect(body("paypal_job_capture_record")).toMatch(/onboarding_fee_amount = CASE WHEN v_fee_rows = 1 THEN/);
    // Visit payments that fund a job count too (phase 6's funds_job_id).
    expect(body("paypal_job_money_rows_exist")).toMatch(/\(to_jsonb\(p\)->>'funds_job_id'\) = p_job_id::text/);
    const sql = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(path.join(MIG, f), "utf8"))).join("\n");
    expect(sql).toMatch(/CREATE TRIGGER trg_paypal_job_money_state_guard\s+BEFORE UPDATE OF payment_status ON public\.jobs\s+FOR EACH ROW EXECUTE FUNCTION public\.paypal_job_money_state_guard\(\)/);
    // The capture record is the one phase-3 writer, and it announces itself.
    expect(body("paypal_job_capture_record")).toMatch(/PERFORM set_config\('app\.paypal_money_write', '1', true\);[\s\S]*SET payment_status = 'escrow'/);
  });

  it("(e) every PayPal SQL function is definer, pinned and revoked from members", () => {
    const names = [...defs.keys()].filter((n) => /^paypal_/.test(n) || n === "job_provider_payment_held");
    expect(names.length).toBeGreaterThan(9);
    const sql = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(path.join(MIG, f), "utf8"))).join("\n");
    const bad: string[] = [];
    for (const n of names) {
      const d = blankSqlComments(defs.get(n)!.stmt);
      // paypal_job_price_matches is a pure comparison (no table read): not definer, still revoked.
      if (n !== "paypal_job_price_matches" && !/SECURITY DEFINER/.test(d)) bad.push(`${n}: not SECURITY DEFINER`);
      if (!/SET search_path TO 'public'/.test(d)) bad.push(`${n}: no fixed search_path`);
      if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${n}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`).test(sql)) bad.push(`${n}: not revoked from PUBLIC, anon, authenticated`);
    }
    expect(bad).toEqual([]);
  });
});
