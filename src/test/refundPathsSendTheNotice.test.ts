/**
 * Q1652 class guard: every code path in supabase/functions that sends money
 * back to the person who paid tells them, through the ONE refund notice
 * (_shared/refundNotice.ts: in the app and by email, the amount, the card, the
 * reference, 5-10 business days, what was kept and why).
 *
 * Owner report 2026-10-12: "was i refunded for mow and weed eat yard? i dont
 * think i got an email that i was refunded". void-cancelled-payments refunded
 * $100.00 of $112.00 and nobody was told: the webhook's notice ran only on a
 * FULL refund, in-app only.
 *
 * The inventory is read from source (comments blanked), never listed by hand:
 *
 *   (A) every `stripe.refunds.create(` raises charge.refunded, so the guard
 *       holds the ONE place that event is handled: index.ts routes it to
 *       handleChargeRefunded, which calls sendRefundNotice for every ordinary
 *       live refund, full OR partial. The only refund it may leave out is an
 *       onboarding-fee correction, which settleOnboardingFee announces itself.
 *   (B) a released hold (`paymentIntents.cancel(`, a partial capture with
 *       `amount_to_capture`) raises no such event, so each one must call the
 *       notice itself within the next few lines, or be on RELEASE_EXEMPT with
 *       the reason no money was held.
 *
 * Counts are EXACT (owner, 2026-09-23): a new refund or release site moves
 * them, and its author must look at whether the person is told.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   if (!isOnboardingFeeCorrection && ordinaryRefunds.length > 0) { |   if (!isOnboardingFeeCorrection && isFullRefund && ordinaryRefunds.length > 0) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       const result = await sendRefundNotice(supabase, { |       const result = await Promise.resolve({ status: "sent", error: "", emailed: false }); void ({
 * @mutate supabase/functions/stripe-webhook/index.ts |   "charge.refunded": handleChargeRefunded, |   "charge.refunded_off": handleChargeRefunded,
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             await tellPosterHoldReleased(job, pi, Number(pi.amount ?? 0), 0, null); |             void tellPosterHoldReleased;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |       const result = await sendRefundNotice(supabaseAdmin, { |       const result = await Promise.resolve({ status: "sent", error: "" }); void ({
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const FN = join(ROOT, "supabase/functions");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Site { file: string; line: number; text: string; following: string }

function sites(pattern: RegExp): Site[] {
  const found: Site[] = [];
  for (const abs of walk(FN)) {
    const code = blankComments(readFileSync(abs, "utf8"));
    const lines = code.split("\n");
    lines.forEach((text, i) => {
      if (pattern.test(text)) {
        found.push({ file: relative(ROOT, abs), line: i + 1, text: text.trim(), following: lines.slice(i, i + 8).join("\n") });
      }
    });
  }
  return found;
}

const refundSites = sites(/\bstripe\.refunds\.create\(/);
const releaseSites = sites(/\bpaymentIntents\.cancel\(|\bamount_to_capture\b/);

/** Releases that hold no money, so there is nothing to tell (file -> reason). EXACT. */
// @two-way src/test/refundPathsSendTheNotice.test.ts:stale RELEASE_EXEMPT entry
const RELEASE_EXEMPT: Record<string, string> = {
  "supabase/functions/create-payment/index.ts":
    "cancels the PaymentIntent of an abandoned 3D Secure challenge before a new checkout: the challenge never completed, so nothing was authorised or held",
};

/** Refunds announced by their own path instead of the webhook (file -> reason). EXACT. */
const REFUND_OWN_NOTICE: Record<string, string> = {
  "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts":
    "a duplicate onboarding-fee correction (metadata.reason duplicate_onboarding_fee) is announced as \"Duplicate fee refunded\"; handleChargeRefunded skips it as a correction",
};

describe("Q1652: every refund path tells the person their money is back", () => {
  it("the inventory is read from source and its counts are exact", () => {
    // EXACT, both directions: a new site moves the number (2026-10-12).
    expect(refundSites.map((s) => `${s.file}:${s.line}`)).toHaveLength(11);
    expect(releaseSites.map((s) => `${s.file}:${s.line}`)).toHaveLength(3);
    // Floors, so a parser that silently reads nothing cannot pass.
    expect(refundSites.length).toBeGreaterThan(8);
    expect(new Set(refundSites.map((s) => s.file)).size).toBeGreaterThan(5);
    expect(releaseSites.length).toBeGreaterThan(1);
  });

  it("(A) charge.refunded is routed to the handler that sends the notice for every live refund, full or partial", () => {
    const index = blankComments(readFileSync(join(FN, "stripe-webhook/index.ts"), "utf8"));
    expect(index).toMatch(/"charge\.refunded":\s*handleChargeRefunded,/);
    const handler = blankComments(readFileSync(join(FN, "stripe-webhook/handlers/chargeRefunded.ts"), "utf8"));
    const gate = handler.split("\n").find((l) => /if \(!isOnboardingFeeCorrection && ordinaryRefunds\.length > 0\)/.test(l));
    expect(gate, "the notice loop's gate (no isFullRefund in it)").toBeDefined();
    expect(gate).not.toMatch(/isFullRefund/);
    const body = handler.slice(handler.indexOf(gate!));
    expect(body).toMatch(/for \(const r of ordinaryRefunds\)/);
    expect(body).toMatch(/await sendRefundNotice\(supabase, \{/);
    expect(body).toMatch(/key: `refund:\$\{r\.id\}`/);
    // The old full-refund-only, in-app-only row is gone for good.
    expect(handler).not.toMatch(/title: "Refund processed"/);
  });

  it("(A) every refund site is covered by charge.refunded unless it announces itself (exact list)", () => {
    const own = refundSites.filter((s) => /duplicate_onboarding_fee/.test(readFileSync(join(ROOT, s.file), "utf8")) && s.file.endsWith("settleOnboardingFee.ts"));
    expect(own.map((s) => s.file).sort()).toEqual(Object.keys(REFUND_OWN_NOTICE).sort());
    const own_src = readFileSync(join(ROOT, Object.keys(REFUND_OWN_NOTICE)[0]), "utf8");
    expect(own_src).toMatch(/Duplicate fee refunded/);
  });

  it("(B) every released hold calls the refund notice right after it, or is exempt with a reason", () => {
    const untold = releaseSites.filter(
      (s) => !/sendRefundNotice\(|tellPosterHoldReleased\(/.test(s.following) && !RELEASE_EXEMPT[s.file],
    );
    expect(untold.map((s) => `${s.file}:${s.line} ${s.text}`)).toEqual([]);
    // The exemption list is exact: every entry still names a real release site.
    const stale = Object.keys(RELEASE_EXEMPT).filter(
      (f) => !releaseSites.some((s) => s.file === f && !/sendRefundNotice\(|tellPosterHoldReleased\(/.test(s.following)),
    );
    expect(stale.map((f) => `stale RELEASE_EXEMPT entry ${f} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("(B) the hold-release notice really sends (claimed on the PaymentIntent, as a release)", () => {
    const v = blankComments(readFileSync(join(FN, "void-cancelled-payments/index.ts"), "utf8"));
    const fn = v.slice(v.indexOf("const tellPosterHoldReleased"), v.indexOf("const settleCancelledJob"));
    expect(fn).toMatch(/const result = await sendRefundNotice\(supabaseAdmin, \{/);
    expect(fn).toMatch(/key: `release:\$\{pi\.id\}`/);
    expect(fn).toMatch(/kind: "release"/);
  });

  it("the notice itself names the amount, the card, the reference, 5-10 business days and what was kept, and is emailed", () => {
    const src = blankComments(readFileSync(join(FN, "_shared/refundNotice.ts"), "utf8"));
    expect(src).toMatch(/\/functions\/v1\/send-notification-email/);
    expect(src).toMatch(/from\("refund_notices"\)\.insert/);
    expect(src).toMatch(/5-10 business days/);
    expect(src).toMatch(/refund reference \$\{ref\}/);
    expect(src).toMatch(/describePaymentMethod\(input\.method\)/);
    expect(src).toMatch(/We kept \$\{kept\}/);
  });
});
