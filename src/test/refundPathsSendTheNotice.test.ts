/**
 * Q1714 class guard: every code path in supabase/functions that sends money
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
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             await tellPosterMoneyBack(job, pi, { key: `release:${pi.id}`, kind: "release", amountCents: Number(pi.amount ?? 0), keptCents: 0, keptReason: null }); |             void tellPosterMoneyBack;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |       const result = await sendRefundNotice(supabaseAdmin, {\n        key: n.key, |       const result = await Promise.resolve({ status: "sent", error: "" }); void ({\n        key: n.key,
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
        found.push({ file: relative(ROOT, abs), line: i + 1, text: text.trim(), following: lines.slice(i, i + 40).join("\n") });
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

/**
 * Files that make a refund WITHOUT calling sendRefundNotice themselves
 * (file -> reason). Every other file with a refunds.create announces its own
 * refund at once, with the amounts it computed (review of Q1714 #3/#9). EXACT.
 */
// @two-way src/test/refundPathsSendTheNotice.test.ts:stale REFUND_OWN_NOTICE entry
const REFUND_OWN_NOTICE: Record<string, string> = {
  "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts":
    "a duplicate onboarding-fee correction (metadata.reason duplicate_onboarding_fee) is announced as \"Duplicate fee refunded\"; handleChargeRefunded skips it as a correction",
  "supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts":
    "refunds a second payment inside the webhook itself; the charge.refunded it raises sends the notice (recipient from the payment's metadata)",
};

/**
 * Notification writes whose words mention a refund but are NOT the payer's
 * refund notice (file -> how many, why). EXACT. Anything else that tells a
 * person about a refund must go through sendRefundNotice, so nobody gets two.
 */
// @two-way src/test/refundPathsSendTheNotice.test.ts:stale REFUND_WORDS_ALLOWED entry
const REFUND_WORDS_ALLOWED: Record<string, { lines: number; why: string }> = {
  "supabase/functions/charge-recurring-visits/index.ts": { lines: 4, why: "the $0 fallback: the card fee took the whole payment, so nothing was refunded" },
  "supabase/functions/create-payment/index.ts": { lines: 4, why: "to the HELPR (two writes): the job they worked was refunded to its poster" },
  "supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts": { lines: 2, why: "a chargeback the bank decided for the card holder: no refund was made" },
  "supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts": { lines: 2, why: "a refund that FAILED after it was made" },
  "supabase/functions/stripe-webhook/handlers/chargeRefunded.ts": { lines: 2, why: "to the HELPR: the decided split cannot be paid" },
  "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts": { lines: 2, why: "the onboarding-fee correction's own notice" },
};

/** title:/message: lines in a notifications write whose words mention a refund. */
function refundWordsInNotices(): Map<string, number> {
  const out = new Map<string, number>();
  for (const abs of walk(FN)) {
    const file = relative(ROOT, abs);
    if (file.endsWith("_shared/refundNotice.ts")) continue;
    const lines = blankComments(readFileSync(abs, "utf8")).split("\n");
    lines.forEach((l, i) => {
      if (!/^\s*(title|message):/.test(l)) return;
      if (!/refund/i.test(lines.slice(i, i + 4).join(" "))) return;
      if (!/from\("notifications"\)\.insert|insertNotifications\(/.test(lines.slice(Math.max(0, i - 8), i).join("\n"))) return;
      out.set(file, (out.get(file) ?? 0) + 1);
    });
  }
  return out;
}

describe("Q1714: every refund path tells the person their money is back", () => {
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

  it("(A) every file that makes a refund announces it through sendRefundNotice, or is on the exact exempt list", () => {
    const files = [...new Set(refundSites.map((s) => s.file))];
    const silent = files.filter((f) => !/sendRefundNotice\(|tellPosterMoneyBack\(|tellVisitRefund\(|tellPayerRefunded\(|announceRefund\(/.test(
      blankComments(readFileSync(join(ROOT, f), "utf8")),
    ));
    expect(silent.sort()).toEqual(Object.keys(REFUND_OWN_NOTICE).sort());
    const stale = Object.keys(REFUND_OWN_NOTICE).filter((f) => !files.includes(f));
    expect(stale.map((f) => `stale REFUND_OWN_NOTICE entry ${f} — remove it (lower the baseline)`)).toEqual([]);
    expect(readFileSync(join(FN, "stripe-webhook/handlers/settleOnboardingFee.ts"), "utf8")).toMatch(/Duplicate fee refunded/);
  });

  it("(A) refunds whose path announces them are skipped by the webhook, and every such path calls the notice", () => {
    const helper = blankComments(readFileSync(join(FN, "_shared/refundNotice.ts"), "utf8"));
    expect(helper).toMatch(/export function pathAnnouncesRefund/);
    // Each mark the webhook defers on is set by a file that sends the notice itself.
    for (const [mark, file] of [
      ["dispute_id: disputeId", "execute-dispute-split/index.ts"],
      ['source: "admin_refund_dispute"', "create-payment/index.ts"],
      ['source: "admin_refund_general"', "create-payment/index.ts"],
      ['fee_withheld: "true"', "charge-recurring-visits/index.ts"],
    ] as const) {
      const src = blankComments(readFileSync(join(FN, file), "utf8"));
      expect(src, `${file} sets ${mark}`).toContain(mark);
      expect(src, `${file} sends the notice itself`).toMatch(/sendRefundNotice\(|announceRefund\(|tellVisitRefund\(/);
    }
  });

  it("(C) no other notification tells a person about a refund (one refund, one notice)", () => {
    const found = Object.fromEntries(refundWordsInNotices());
    const allowed = Object.fromEntries(Object.entries(REFUND_WORDS_ALLOWED).map(([f, v]) => [f, v.lines]));
    expect(found).toEqual(allowed);
    const stale = Object.keys(REFUND_WORDS_ALLOWED).filter((f) => !(f in found));
    expect(stale.map((f) => `stale REFUND_WORDS_ALLOWED entry ${f} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("(B) every released hold calls the refund notice right after it, or is exempt with a reason", () => {
    const untold = releaseSites.filter(
      (s) => !/sendRefundNotice\(|tellPosterMoneyBack\(/.test(s.following) && !RELEASE_EXEMPT[s.file],
    );
    expect(untold.map((s) => `${s.file}:${s.line} ${s.text}`)).toEqual([]);
    // The exemption list is exact: every entry still names a real release site.
    const stale = Object.keys(RELEASE_EXEMPT).filter(
      (f) => !releaseSites.some((s) => s.file === f && !/sendRefundNotice\(|tellPosterMoneyBack\(/.test(s.following)),
    );
    expect(stale.map((f) => `stale RELEASE_EXEMPT entry ${f} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("(B) the hold-release notice really sends (claimed on the PaymentIntent, as a release)", () => {
    const v = blankComments(readFileSync(join(FN, "void-cancelled-payments/index.ts"), "utf8"));
    const fn = v.slice(v.indexOf("const tellPosterMoneyBack"), v.indexOf("const settleCancelledJob"));
    expect(fn).toMatch(/const result = await sendRefundNotice\(supabaseAdmin, \{/);
    // Both releases (full void, fee capture) are keyed on the PaymentIntent.
    expect(v.match(/key: `release:\$\{pi\.id\}`, kind: "release"/g)?.length).toBe(2);
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
