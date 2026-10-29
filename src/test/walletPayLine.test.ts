// Board 186 (owner 2026-10-21): the pay button's line names only the wallets live on the Stripe account.
// Measured live 2026-10-21 (default payment method configuration): Apple Pay on, Google Pay on (Q2270).
// Changing LIVE_WALLETS needs a fresh live read; this pins today's list so it cannot drift by accident.
// @mutate src/lib/walletsLive.ts | export const LIVE_WALLETS: readonly string[] = ["Apple Pay", "Google Pay"]; | export const LIVE_WALLETS: readonly string[] = ["Apple Pay"];
// @mutate src/pages/post-job/FormStep.tsx | form.hasGift ? | false ?
// @mutate src/pages/post-job/FormStep.tsx | : form.cardHoldOn ? "Your card isn't charged | : false ? "Your card isn't charged
// @mutate src/components/postjob/CheckoutStep.tsx | `${payNextLine()} Held safely until the job's done.` | "Held safely until the job's done."
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIVE_WALLETS, payNextLine } from "@/lib/walletsLive";
import { blankComments } from "./helpers/blankNonCode";

describe("board 186: the pay line names only live wallets", () => {
  it("today: card, Apple Pay, Google Pay or bank (both wallets measured on, Q2270)", () => {
    expect(LIVE_WALLETS).toEqual(["Apple Pay", "Google Pay"]);
    expect(payNextLine()).toBe("Next: pay by card, Apple Pay, Google Pay or bank on a secure page.");
    expect(payNextLine([])).toBe("Next: pay by card or bank on a secure page.");
  });

  it("the Post a Job pay button carries it (not on a gift-covered post, which has no payment page)", () => {
    const src = blankComments(readFileSync("src/components/postjob/CheckoutStep.tsx", "utf8"));
    expect(src).toMatch(/giftCoversEverything \? "Held safely until the job's done\." : `\$\{payNextLine\(\)\} Held safely until the job's done\.`/);
  });

  it("the charge moment is said early (owner 2026-10-21, friction 2): price screen, review screen, button", () => {
    const form = blankComments(readFileSync("src/pages/post-job/FormStep.tsx", "utf8"));
    expect(form).toMatch(/"You're charged when you post\. The money is held until the job is done\."/);
    // A gift card can cover all of it (money review 2026-10-21 #1): never promise a charge then.
    expect(form).toMatch(/form\.hasGift \? "Your gift card pays first\. Anything left is charged when you post/);
    expect(form).toMatch(/submitLabel = "Review, then pay"/);
    // Q2399 card_hold_at_post (audit 2026-10-28 F3): the price screen follows the same flag the review
    // screen does; with it on, the card is charged at the hire, never "when you post".
    expect(form).toMatch(/: form\.cardHoldOn \? "Your card isn't charged until you hire someone\. The money is then held until the job is done\." : "You're charged when you post/);
    const review = blankComments(readFileSync("src/pages/post-job/CheckoutStepView.tsx", "utf8"));
    expect(review).toMatch(/You're charged when you post, and the money is held until the job is done\./);
  });
});
