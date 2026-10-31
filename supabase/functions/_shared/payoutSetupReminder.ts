/**
 * The words of the payout setup reminders (owner decision 2026-10-25, switch
 * payout_after_hire; copy approved by the lead 2026-10-25, "a few minutes",
 * never a promised time). The 'hired' one is the app's "You're hired" prompt
 * word for word (src/lib/payoutAfterHire.ts; the guard
 * src/test/payoutAfterHire.test.ts keeps the two equal).
 *
 * ZERO imports, so the edge harness and the app's tests read the real module.
 */
export type PayoutSetupReminderStage = "hired" | "day1" | "day3" | "day7" | "money";

export const PAYOUT_SETUP_REMINDER_LINK = "/profile?tab=payment";
/** User-facing and about money they are owed: the category the prefs screen calls "Payments & Tips". */
export const PAYOUT_SETUP_REMINDER_TYPE = "financial_alerts";

const HIRED_TITLE = "You're hired. Set up payouts to get paid.";
const HIRED_BODY =
  "The job is yours. Stripe checks your ID and adds your bank in one short step, a few minutes, once. Your pay for this job is held safely until it's done.";
const NUDGE_TITLE = "Finish payout setup to get paid";
const NUDGE_BODY =
  "You have a job on Helpr. Finish your payout setup (Stripe ID check and bank, a few minutes) so your pay can reach you.";

/** Owner 2026-10-30: payout account ready, ID outstanding: this notice asks for the ID alone. */
export const IDENTITY_REMINDER_LINK = "/home?verify_id=1";
export function identityReminderCopy(stage: PayoutSetupReminderStage, jobTitle: string | null): { title: string; message: string } {
  const named = jobTitle?.trim() ? `"${jobTitle.trim()}"` : "your job";
  if (stage === "money") {
    return { title: "Verify your ID to get paid", message: `Your pay from ${named} is waiting. Verify your ID once with Stripe, about 2 minutes, and we send it.` };
  }
  return {
    title: stage === "hired" ? "You're hired. Verify your ID before you head out." : "Verify your ID before you head out",
    message: `You can't head out to ${named} until Stripe checks your ID. It takes about 2 minutes, once. Your pay waits for it too.`,
  };
}

/** Title and message for one reminder. `jobTitle` names the job a 'money' reminder is about. */
export function payoutSetupReminderCopy(stage: PayoutSetupReminderStage, jobTitle: string | null): { title: string; message: string } {
  if (stage === "hired") return { title: HIRED_TITLE, message: HIRED_BODY };
  if (stage === "money") {
    const job = jobTitle?.trim() ? `"${jobTitle.trim()}"` : "your job";
    return {
      title: NUDGE_TITLE,
      message: `Your pay from ${job} is held until your payout account is ready. Finish your payout setup (Stripe ID check and bank, a few minutes) so it can reach you.`,
    };
  }
  return { title: NUDGE_TITLE, message: NUDGE_BODY };
}
