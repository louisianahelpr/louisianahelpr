/**
 * F236 / F258 (whole-app audit 11-10, lead confirmed live: the Help center and the Terms showed no fee amounts).
 * Help and the Terms now name the amounts from ONE source each, never a hand-typed number:
 *  - the one-time account setup fee: read live from platform_settings (useOnboardingFeeCents, the number
 *    pay-onboarding-fee charges); Help fills SETUP_FEE_PHRASE with it, the Terms short version quotes it;
 *  - the Declutter buyer's fee: DECLUTTER_BUYER_FEE_WORDS, built from the constants checkoutAmounts charges.
 * Owner 10-25 (no Jobs fee words or numbers) still holds: no Helpr fee rate appears.
 *
 * @mutate src/lib/declutter/money.ts | export const DECLUTTER_BUYER_FEE_FIXED_CENTS = BUYER_FEE_FIXED_CENTS; | export const DECLUTTER_BUYER_FEE_FIXED_CENTS = 75;
 * @mutate src/pages/info/HelpCenter.tsx |   const allSections = withSetupFeeAmount(shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS, setupFeeLabel); |   const allSections = shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS;
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Your first paid job also carries ${SETUP_FEE_PHRASE}, | Your first paid job also carries a small one-time account setup fee,
 * @mutate src/pages/info/legal/TermsSection.tsx | `One-time account setup fee${feeLabel ? `: ${feeLabel}` : ""}, charged once per account. | `One-time account setup fee, charged once per account.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { checkoutAmounts, DECLUTTER_BUYER_FEE_FIXED_CENTS, DECLUTTER_BUYER_FEE_PERCENT, DECLUTTER_BUYER_FEE_WORDS } from "@/lib/declutter/money";
import { FAQ_SECTIONS, SETUP_FEE_PHRASE, withSetupFeeAmount } from "@/pages/info/helpCenter/helpCenterContent";

const ROOT = join(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));
const answers = FAQ_SECTIONS.flatMap((s) => s.items);
const feesAnswer = () => answers.find((x) => x.q === "What fees does Helpr charge?")!.a;

describe("fee amounts in Help and the Terms come from the checkout's own numbers (F236, F258)", () => {
  it("the buyer's fee words match what checkoutAmounts charges", () => {
    // A $10 item: checkoutAmounts' fee must equal percent-of-price + fixed cents, the numbers the words quote.
    const { premiumCents } = checkoutAmounts([1000]);
    expect(premiumCents).toBe(Math.round(1000 * DECLUTTER_BUYER_FEE_PERCENT / 100) + DECLUTTER_BUYER_FEE_FIXED_CENTS);
    expect(DECLUTTER_BUYER_FEE_WORDS).toBe(`${DECLUTTER_BUYER_FEE_PERCENT}% of the item price plus ${DECLUTTER_BUYER_FEE_FIXED_CENTS} cents`);
    expect(DECLUTTER_BUYER_FEE_WORDS).toBe("5% of the item price plus 70 cents");
  });

  it("Help's fees answer names the buyer's fee and the setup fee phrase, and no Jobs fee rate", () => {
    const a = feesAnswer();
    expect(a).toContain(`buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS}`);
    expect(a).toContain(SETUP_FEE_PHRASE);
    expect(a).not.toMatch(/10%|helpr fee of/i);
  });

  it("Help fills the setup fee amount from the live setting, and quotes no number without it", () => {
    const filled = withSetupFeeAmount(FAQ_SECTIONS, "$2").flatMap((s) => s.items);
    expect(filled.find((x) => x.q === "What fees does Helpr charge?")!.a).toContain("a one-time $2 account setup fee");
    expect(filled.some((x) => x.a.includes(SETUP_FEE_PHRASE))).toBe(false);
    expect(withSetupFeeAmount(FAQ_SECTIONS, null)).toBe(FAQ_SECTIONS);
    const page = code("src/pages/info/HelpCenter.tsx");
    expect(page).toContain("formatFeeLabel(useOnboardingFeeCents())");
    expect(page).toMatch(/withSetupFeeAmount\([^;]*setupFeeLabel\)/);
  });

  it("no Help answer hand-types a setup fee amount", () => {
    for (const x of answers) expect(x.a).not.toMatch(/\$\d+(\.\d\d)? (one-time |account )?setup fee/i);
  });

  it("the Terms short version quotes the live setup fee and the buyer's fee words", () => {
    const terms = code("src/pages/info/legal/TermsSection.tsx");
    expect(terms).toContain('`One-time account setup fee${feeLabel ? `: ${feeLabel}` : ""}, charged once per account.');
    expect(terms).toContain("buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS}, once per checkout");
    expect(terms).toContain("buyer&apos;s fee of {DECLUTTER_BUYER_FEE_WORDS}, once per checkout");
    expect(terms).not.toMatch(/5% of the item price plus 70 cents/);
  });
});
