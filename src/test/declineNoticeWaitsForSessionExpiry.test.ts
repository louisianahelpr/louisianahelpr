/**
 * Q769 class check: nothing may tell a poster "the job isn't posted, load your
 * draft" while the Checkout Session can still be paid, and "Load Draft" must
 * know whether the draft's last checkout is paid or still live.
 *
 * Class, derived from the tree: every stripe-webhook handler is scanned; the
 * only one allowed to send the not-posted notice is checkoutSessionExpired.
 * A decline (payment_intent.payment_failed) is retryable inside the session,
 * so a notice there sends the poster to pay twice.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | logStep("Job marked failed; poster is told on session expiry" | logStep("Job marked failed; the job isn't posted"
 * @mutate src/pages/post-job/useJobSubmit.ts | safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, jobId); | void jobId;
 * @mutate src/pages/post-job/EntryChoice.tsx | form.hasDraft && draftCheckout !== "paid" && | form.hasDraft &&
 * @mutate src/pages/post-job/useDraftCheckoutState.ts | return row.stripe_session_id ? "open" : "none"; | return "none";
 * @mutate src/pages/post-job/useDraftCheckoutState.ts | safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY) ? "open" : "none", | "none",
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { classifyDraftCheckout } from "@/pages/post-job/useDraftCheckoutState";

const HANDLERS = "supabase/functions/stripe-webhook/handlers";
const NOT_POSTED = /isn['’]t posted|load your draft/i;
const read = (p: string) => readFileSync(p, "utf8");

describe("Q769: the not-posted notice waits for session expiry", () => {
  it("only checkoutSessionExpired sends the not-posted notice", () => {
    const files = readdirSync(HANDLERS).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    const senders = files.filter((f) => {
      const src = read(join(HANDLERS, f)).replace(/^\s*\/\/.*$/gm, "");
      return NOT_POSTED.test(src);
    });
    expect(senders).toEqual(["checkoutSessionExpired.ts"]);
  });

  it("the expiry notice fires only for a job still marked failed", () => {
    const src = read(join(HANDLERS, "checkoutSessionExpired.ts"));
    expect(src).toMatch(/released\.payment_status === "failed"/);
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
