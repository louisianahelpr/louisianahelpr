/**
 * Q769 class check: nothing may tell a poster "the job isn't posted, load your
 * draft" while the Checkout Session can still be paid, and "Load Draft" must
 * know whether the draft's last checkout is paid or still live.
 *
 * Class, derived from the tree: every stripe-webhook handler is scanned; the
 * only handlers allowed to send the not-posted notice are those that fire after
 * the session can no longer be paid:
 *   - checkoutSessionExpired: the session window is over.
 *   - paymentIntentPaymentFailed: only when stripe_session_id is null, meaning
 *     the session already expired days before the ACH bounce arrived (ME-046).
 *     A card decline inside a live session is retryable, so that path is still
 *     routed through checkoutSessionExpired.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | sessionAlreadyExpired = !(failedJob as any).stripe_session_id | sessionAlreadyExpired = true
 * @mutate src/pages/post-job/useJobSubmit.ts | safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, jobId); | void jobId;
 * @mutate src/pages/post-job/EntryChoice.tsx | form.hasDraft && draftCheckout !== "paid" && | form.hasDraft &&
 * @mutate src/pages/post-job/useDraftCheckoutState.ts | return row.stripe_session_id ? "open" : "none"; | return "none";
 * @mutate src/pages/post-job/useDraftCheckoutState.ts | safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY) ? "open" : "none", | "none",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyDraftCheckout } from "@/pages/post-job/useDraftCheckoutState";
import { readdirSync } from "./helpers/trackedFiles";

const HANDLERS = "supabase/functions/stripe-webhook/handlers";
const NOT_POSTED = /isn['’]t posted|load your draft/i;
const read = (p: string) => readFileSync(p, "utf8");

describe("Q769: the not-posted notice waits for session expiry", () => {
  it("only session-expired handlers send the not-posted notice", () => {
    const files = readdirSync(HANDLERS).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    const senders = files.filter((f) => {
      const src = read(join(HANDLERS, f)).replace(/^\s*\/\/.*$/gm, "");
      return NOT_POSTED.test(src);
    });
    // checkoutSessionExpired: session window is over.
    // paymentIntentPaymentFailed: only when stripe_session_id is null (ME-046 ACH path).
    // Any other sender violates Q769 (notice before the session can no longer be paid).
    expect(senders.sort()).toEqual(["checkoutSessionExpired.ts", "paymentIntentPaymentFailed.ts"]);
  });

  it("the expiry notice fires only for a job still marked failed", () => {
    const src = read(join(HANDLERS, "checkoutSessionExpired.ts"));
    expect(src).toMatch(/released\.payment_status === "failed"/);
  });

  it("paymentIntentPaymentFailed's not-posted notice is gated behind stripe_session_id being null", () => {
    const src = read(join(HANDLERS, "paymentIntentPaymentFailed.ts"));
    // Guard: only fires when the checkout session has already cleared (can no longer be paid).
    expect(src).toMatch(/sessionAlreadyExpired\s*=\s*!\(failedJob/);
    expect(src).toMatch(/if \(sessionAlreadyExpired && failedJob\.customer_id\)/);
  });
});

describe("Q769: Load Draft knows the draft's last checkout", () => {
  it("the checkout redirect records the job the draft paid for", () => {
    const src = read("src/pages/post-job/useJobSubmit.ts");
    const set = src.indexOf("safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, jobId)");
    const open = src.indexOf("await openExternalUrl(paymentUrl)");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(open);
  });

  it("Entry hides Load Draft for a paid job and reads the checkout state", () => {
    const src = read("src/pages/post-job/EntryChoice.tsx");
    expect(src).toContain("useDraftCheckout(form.hasDraft)");
    expect(src).toContain('form.hasDraft && draftCheckout !== "paid"');
    expect(src).toMatch(/draftCheckout === "open"/);
  });

  it("the hook warns from the first render while a checkout job is on record", () => {
    const src = read("src/pages/post-job/useDraftCheckoutState.ts");
    expect(src).toMatch(/useState<DraftCheckoutState>\(\(\) =>\s*safeStorage\.getItem\(DRAFT_CHECKOUT_JOB_KEY\) \? "open" : "none"/);
  });

  it("classifies every payment state", () => {
    expect(classifyDraftCheckout(null)).toBe("none");
    expect(classifyDraftCheckout({ payment_status: "unpaid", stripe_session_id: "cs_1" })).toBe("open");
    expect(classifyDraftCheckout({ payment_status: "failed", stripe_session_id: "cs_1" })).toBe("open");
    expect(classifyDraftCheckout({ payment_status: null, stripe_session_id: "cs_1" })).toBe("open");
    expect(classifyDraftCheckout({ payment_status: "unpaid", stripe_session_id: null })).toBe("none");
    expect(classifyDraftCheckout({ payment_status: "failed", stripe_session_id: null })).toBe("none");
    expect(classifyDraftCheckout({ payment_status: "abandoned", stripe_session_id: null })).toBe("none");
    for (const paid of ["escrow", "payout_pending", "released", "refunded"]) {
      expect(classifyDraftCheckout({ payment_status: paid, stripe_session_id: "cs_1" })).toBe("paid");
    }
  });
});
