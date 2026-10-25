/**
 * Confirm-your-email reminders (lead, 2026-10-25): the words, in one place.
 * WHO gets one is decided in SQL (public.claim_confirm_reminders); the sender
 * is confirm-reminders/index.ts and the template
 * email-templates/confirmReminder.tsx. At most two per account: step 1 about an
 * hour after sign-up, step 2 about a day.
 *
 * Zero imports on purpose, so a vitest can load it
 * (src/test/confirmReminders.test.ts holds the copy rules: sentence case, no
 * exclamation marks, "Helpr" never "helper", step 2 says it is the last one).
 */

export type ConfirmReminderStep = 1 | 2;

/** email_send_log.template_name and the queue label for each step. */
export function confirmReminderTemplateName(step: ConfirmReminderStep): string {
  return `confirm_reminder_${step}`;
}

export interface ConfirmReminderCopy {
  subject: string;
  preheader: string;
  heading: string;
  body: string[];
  button: string;
  after: string;
}

export const CONFIRM_REMINDER_COPY: Record<ConfirmReminderStep, ConfirmReminderCopy> = {
  1: {
    subject: "Confirm your email to finish signing up",
    preheader: "One tap and your Louisiana Helpr account is ready.",
    heading: "One step left",
    body: [
      "You started a Louisiana Helpr account but haven't confirmed your email yet.",
      "Tap the button, then tap Confirm my email on the page that opens.",
    ],
    button: "Confirm my email",
    after: "If the link has run out by the time you tap it, the page will send you a new one.",
  },
  2: {
    subject: "Your Louisiana Helpr account is waiting",
    preheader: "Confirm your email and you're in.",
    heading: "Your account is waiting",
    body: [
      "Your Louisiana Helpr account is set up, but your email still isn't confirmed, so you can't post or take jobs yet.",
      "Tap the button, then tap Confirm my email on the page that opens.",
    ],
    button: "Confirm my email",
    after: "This is the last reminder we'll send. If the link has run out by the time you tap it, the page will send you a new one.",
  },
};
