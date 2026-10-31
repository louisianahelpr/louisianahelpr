/**
 * The Helpr Guarantee in plain words, for screens that SELL it (first post's
 * Review step, /book/<id>). One constant so no screen can
 * drift into a bigger promise than the terms make (lead + owner, 2026-10-29:
 * "never overpromise"; no fee details on these screens).
 *
 * The binding terms are the "Helpr Guarantee" row of the Terms
 * (src/pages/info/legal/TermsSection.tsx): redo first, within
 * GUARANTEE_RULES.claimWindowHours of the job being done, on a one-Helpr job;
 * if the Helpr can't or the fix doesn't solve it, Helpr decides it as a
 * dispute. "Louisiana Helpr steps in" is that last step, and nothing more:
 * no refund is promised here, because the terms don't promise one.
 * src/test/guaranteePromiseMatchesTerms.test.ts holds the two in step.
 */
import { GUARANTEE_RULES } from "./rules";

export const GUARANTEE_PROMISE_TITLE = "Covered by the Helpr Guarantee";

export const GUARANTEE_PROMISE_BODY =
  `If a one-Helpr job isn't done right, tell us within ${GUARANTEE_RULES.claimWindowHours} hours and your Helpr comes back to fix it. ` +
  "If it still isn't right, Louisiana Helpr steps in.";

/** Payment is held, not paid out, until the person who posted approves the work (owner 2026-10-23). */
export const PAYMENT_HELD_LINE = "Your payment is held safely until you confirm the work is done.";

/** "How it works" goes to the full terms (the Terms tab of /legal holds the Helpr Guarantee row). */
export const GUARANTEE_TERMS_HREF = "/legal";
