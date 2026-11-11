// Board 186 (owner 2026-10-21): the pay button's line names only the wallets live on the Stripe account.
// Measured live 2026-10-21 (default payment method configuration): Apple Pay on, Google Pay on (Q2270).
// Changing LIVE_WALLETS needs a fresh live read; this pins today's list so it cannot drift by accident.
// @mutate src/lib/walletsLive.ts | export const LIVE_WALLETS: readonly string[] = ["Apple Pay", "Google Pay"]; | export const LIVE_WALLETS: readonly string[] = ["Apple Pay"];
// @mutate src/pages/post-job/FormStep.tsx | form.hasGift ? | false ?
// @mutate src/pages/post-job/FormStep.tsx | : form.cardHoldOn ? CARD_HOLD_COPY.postPromise | : false ? CARD_HOLD_COPY.postPromise
// audit 11-10 F299: one money promise on the price step, the review step and the Stripe page.
// @mutate src/pages/post-job/CheckoutStepView.tsx | ? `Check your job. ${CARD_HOLD_COPY.postPromise}` | ? "Check your job."
// @mutate supabase/functions/create-payment/index.ts | ...(holdPlan ? { custom_text: { submit: { message: CARD_HOLD_COPY.checkout(threeDSCents, owesOnboardingFee ? onboardingFeeCents : 0) } } } : {}), |
// @mutate src/components/postjob/CheckoutStep.tsx | `${payNextLine()} Held safely until the job's done.` | "Held safely until the job's done."
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIVE_WALLETS, payNextLine } from "@/lib/walletsLive";
import { CARD_HOLD_COPY } from "../../supabase/functions/_shared/cardHoldCopy";
import { blankComments } from "./helpers/blankNonCode";

describe("board 186: the pay line names only live wallets", () => {
  it("today: card, Apple Pay, Google Pay or bank (both wallets measured on, Q2270)", () => {
    expect(LIVE_WALLETS).toEqual(["Apple Pay", "Google Pay"]);
    expect(payNextLine()).toBe("Next: pay by card, Apple Pay, Google Pay or bank on a secure page.");
    expect(payNextLine([])).toBe("Next: pay by card or bank on a secure page.");
  });

  it("the Post a Job pay button carries it (not on a gift-covered post, which has no payment page)", () => {
    const src = blankComments(readFileSync("src/components/postjob/CheckoutStep.tsx", "utf8"));
    // F304 (owner 2026-11-11): a plain job's card says "Held safely until you approve the work.", so its line is the pay line alone.
    expect(src).toMatch(/giftCoversEverything \? "Held safely until the job's done\." : plainYouPay \? payNextLine\(\) : `\$\{payNextLine\(\)\} Held safely until the job's done\.`/);
  });

  it("the charge moment is said early (owner 2026-10-21, friction 2): price screen, review screen, button", () => {
    const form = blankComments(readFileSync("src/pages/post-job/FormStep.tsx", "utf8"));
    expect(form).toMatch(/"You're charged when you post\. The money is held until the job is done\."/);
    // A gift card can cover all of it (money review 2026-10-21 #1): never promise a charge then.
    expect(form).toMatch(/form\.hasGift \? "Your gift card pays first\. Anything left is charged when you post/);
    // A3-3 part 2: the label is the "postJob.reviewThenPay" key, whose English is "Review, then pay".
    expect(form).toMatch(/submitLabel = t\("postJob\.reviewThenPay"\)/);
    expect(readFileSync("src/lib/i18n/enPostJob.ts", "utf8")).toContain('"postJob.reviewThenPay": "Review, then pay",');
    // Q2399 card_hold_at_post (audit 2026-10-28 F3): the price screen follows the same flag the review
    // screen does; with it on, the card is charged at the hire, never "when you post".
    expect(form).toMatch(/: form\.cardHoldOn \? CARD_HOLD_COPY\.postPromise : "You're charged when you post/);
    const review = blankComments(readFileSync("src/pages/post-job/CheckoutStepView.tsx", "utf8"));
    expect(review).toMatch(/You're charged when you post, and the money is held until the job is done\./);
  });

  it("with the card hold on, the price step, the review step and the Stripe page make ONE promise (audit 11-10 F299)", () => {
    expect(CARD_HOLD_COPY.postPromise).toBe("Your card is held, not charged, until a Helpr accepts your offer. A bank payment is charged when you post. Either way the money is held until the job is done.");
    const review = blankComments(readFileSync("src/pages/post-job/CheckoutStepView.tsx", "utf8"));
    expect(review).toContain("? `Check your job. ${CARD_HOLD_COPY.postPromise}`");
    expect(review).not.toMatch(/isn't charged until|A bank payment is charged when you post/);
    const form = blankComments(readFileSync("src/pages/post-job/FormStep.tsx", "utf8"));
    expect(form).not.toMatch(/isn't charged until/);
    // The Stripe page: under the Pay button, the real hold, card and bank told apart.
    expect(CARD_HOLD_COPY.checkout(2500)).toBe("Pay by card and it's held for $25, not charged: you're only charged when you hire someone. Pay by bank and it's charged now. Either way the money is held until the job is done.");
    expect(CARD_HOLD_COPY.checkout(4200, 200)).toContain("held for $42, including the one-time $2 setup fee, not charged");
    const edge = blankComments(readFileSync("supabase/functions/create-payment/index.ts", "utf8"));
    expect(edge).toContain("...(holdPlan ? { custom_text: { submit: { message: CARD_HOLD_COPY.checkout(threeDSCents, owesOnboardingFee ? onboardingFeeCents : 0) } } } : {}),");
  });
});
