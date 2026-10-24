/**
 * CLASS GUARD (PayPal Plan A, phase 4): no Stripe payout path pays a job that was paid through PayPal.
 *
 * A PayPal-paid job's money is in HELPR's PayPal balance, not Stripe's, and its Helpr is paid BY HAND
 * from the admin "Pay this Helpr" queue (public.paypal_queue_manual_payout, then Mark paid). If a
 * Stripe path reached it, it would either transfer platform money that never came in, on top of the
 * manual payout (the Helpr paid twice), or treat the manual payout's pending payout_transfers claim as
 * an orphaned Stripe claim and RESUME it with a Stripe transfer (_shared/payoutClaim.ts).
 *
 * INVENTORY, from source: every edge function index.ts whose code (comments blanked) names the
 * 'payout_pending' state AND moves Helpr money (stripe transfers.create, the claimPayout claim, or a
 * call to release-payout). Each must ask _shared/payments/manualPayoutQueue.ts whether the job is
 * PayPal's (jobPaypalPayment / paypalJobIds) BEFORE its first money call; create-payment does it in
 * its release action, after the approval write that schedules the payout. A new file that joins the
 * class without the check fails here.
 *
 * Also: the Stripe "Payout Queue" RPCs (get_payout_batches and get_payout_batch_job_ids, newest
 * effective definitions) leave PayPal jobs out, so Send Payout never offers or pays one; and every
 * reader uses ONE rule for "PayPal's job" (a payment past created/voided/failed, phase 3's rule).
 *
 * @mutate supabase/functions/release-payout/index.ts | const paypalPayment = await jobPaypalPayment(supabaseAdmin, job.id); | const paypalPayment = { kind: "none" } as { kind: string; message?: string };
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const paypalIds = await paypalJobIds(supabaseAdmin, | const paypalIds = await Promise.resolve({ ok: true as const, ids: new Set<string>() }) ?? (supabaseAdmin,
 * @mutate supabase/functions/auto-release-payment/index.ts | const duePaypal = await paypalJobIds(supabaseAdmin, | const duePaypal = await Promise.resolve({ ok: true as const, ids: new Set<string>() }) ?? (supabaseAdmin,
 * @mutate supabase/functions/execute-dispute-split/index.ts | const paypalPayment = await jobPaypalPayment(supabaseAdmin, job.id); | const paypalPayment = { kind: "none" } as { kind: string; message?: string };
 * @mutate supabase/functions/create-payment/index.ts | const paypalPayment = await jobPaypalPayment(supabaseAdmin, jobId); | const paypalPayment = { kind: "none" } as { kind: string; message?: string };
 * @mutate supabase/migrations/20261023231811_paypal_manual_payout_queue.sql | job_provider_payment_held rule): a poster who fell back to a card is still paid through Stripe.\n    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp\n                     WHERE pp.subject_kind = 'job' | job_provider_payment_held rule): a poster who fell back to a card is still paid through Stripe.\n    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp\n                     WHERE pp.subject_kind = 'tip'
 * @mutate supabase/migrations/20261023231811_paypal_manual_payout_queue.sql | Payout is a Stripe transfer, and a PayPal job is paid from admin_paypal_payout_queue().\n    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp\n                     WHERE pp.subject_kind = 'job' | Payout is a Stripe transfer, and a PayPal job is paid from admin_paypal_payout_queue().\n    AND NOT EXISTS (SELECT 1 FROM public.provider_payments pp\n                     WHERE pp.subject_kind = 'tip'
 * @mutate supabase/functions/_shared/payments/manualPayoutQueue.ts | const NOT_PAYPAL_YET = "(created,voided,failed)"; | const NOT_PAYPAL_YET = "(created,voided,failed,captured)";
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = path.resolve(__dirname, "../..");
const FN_DIR = path.join(ROOT, "supabase", "functions");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const MONEY_CALL = /transfers\.create\(|claimPayout\(|\/release-payout\b/g;
const PAYPAL_CHECK = /\bjobPaypalPayment\(|\bpaypalJobIds\(/g;

const code = (rel: string) => blankComments(readFileSync(path.join(ROOT, rel), "utf8"));
const firstIndex = (src: string, re: RegExp) => {
  re.lastIndex = 0;
  const m = re.exec(src);
  return m ? m.index : -1;
};

function inventory(): string[] {
  return readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => path.join("supabase", "functions", d.name, "index.ts"))
    .filter((rel) => existsSync(path.join(ROOT, rel)))
    .filter((rel) => {
      const src = code(rel);
      return /["']payout_pending["']/.test(src) && firstIndex(src, MONEY_CALL) >= 0;
    })
    .sort();
}

describe("no Stripe payout path pays a PayPal-paid job", () => {
  const files = inventory();

  it("reads a real inventory (floor)", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files).toContain("supabase/functions/release-payout/index.ts");
    expect(files).toContain("supabase/functions/process-scheduled-payouts/index.ts");
  });

  it("every payout path asks whether the job was paid through PayPal before it moves money", () => {
    const missing: string[] = [];
    for (const rel of files) {
      const src = code(rel);
      const check = firstIndex(src, PAYPAL_CHECK);
      if (rel.endsWith("create-payment/index.ts")) {
        // Its money calls belong to other actions; the payout it schedules is the release action's.
        const start = src.indexOf('if (action === "release") {');
        const end = src.indexOf('if (action === "', start + 10);
        const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : "";
        const scheduled = block.indexOf('updateFields.payment_status = "payout_pending";');
        const asked = firstIndex(block, PAYPAL_CHECK);
        if (scheduled < 0 || asked < scheduled) missing.push(`${rel}: release action does not queue a PayPal job after scheduling its payout`);
        continue;
      }
      const money = firstIndex(src, MONEY_CALL);
      if (check < 0 || check > money) missing.push(`${rel}: no PayPal check before the first money call`);
    }
    expect(missing).toEqual([]);
  });

  it("auto-release-payment asks again for the matured payouts it hands to release-payout", () => {
    const src = code("supabase/functions/auto-release-payment/index.ts");
    const dueRead = src.indexOf("await dueQuery2");
    const handOff = src.indexOf("/release-payout", dueRead);
    expect(dueRead).toBeGreaterThan(0);
    expect(handOff).toBeGreaterThan(dueRead);
    const between = src.slice(dueRead, handOff);
    PAYPAL_CHECK.lastIndex = 0;
    expect(PAYPAL_CHECK.test(between)).toBe(true);
  });

  // A job is PayPal's once it has a payment past created/voided/failed (phase 3's rule): an abandoned
  // PayPal order must not hide a card-paid job from the Stripe queue, and a real one must hide it.
  const PAYPAL_JOB_EXCLUDED = /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.provider_payments\s+pp\s+WHERE\s+pp\.subject_kind\s*=\s*'job'\s+AND\s+pp\.subject_id\s*=\s*j\.id\s+AND\s+pp\.status\s+NOT\s+IN\s*\(\s*'created'\s*,\s*'voided'\s*,\s*'failed'\s*\)\s*\)/i;

  it("the Stripe Payout Queue and the job ids its Send Payout pays (get_payout_batches, get_payout_batch_job_ids) leave PayPal jobs out", () => {
    const defs = effectiveDefs(MIGRATIONS);
    for (const fn of ["get_payout_batches", "get_payout_batch_job_ids"]) {
      const def = defs.get(fn);
      expect(def, fn).toBeDefined();
      expect(blankSqlComments(def!.stmt), fn).toMatch(PAYPAL_JOB_EXCLUDED);
    }
  });

  it("the edge helper uses the same rule (statuses that do not make a job PayPal's)", () => {
    const src = code("supabase/functions/_shared/payments/manualPayoutQueue.ts");
    expect(src).toMatch(/const NOT_PAYPAL_YET = "\(created,voided,failed\)";/);
    expect((src.match(/\.not\("status", "in", NOT_PAYPAL_YET\)/g) ?? []).length).toBe(2);
  });
});
