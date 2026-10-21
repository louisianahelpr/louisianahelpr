/**
 * Come-back emails (owner said yes, 2026-10-21): the words, in one place.
 *
 * A short note from the founder to a member who signed up and never came
 * back: step 1 about day 3, step 2 about day 10, never more than two. WHO gets
 * one is decided in SQL (public.claim_come_back_emails, migration
 * 20261021113827); this file is only what the email says. The template is
 * email-templates/comeBack.tsx and the sender is come-back-emails/index.ts.
 *
 * Zero imports on purpose, so a vitest can load it
 * (src/test/comeBackEmails.test.ts holds the copy rules: sentence case, no
 * exclamation marks, "Helpr" never "helper", the shipped how-it-works lines,
 * and step 2 says it is the last one).
 *
 * The product lines in the bullets are the landing page's own
 * (src/components/landing/HowItWorksSection.tsx). FOUNDER_NAME is the
 * sign-off; the owner confirms it before the switch is turned on.
 */

/** The hidden switch the whole feature sits behind (public.feature_switches.key). */
export const COME_BACK_SWITCH = "come_back_emails";

export type ComeBackStep = 1 | 2;

/** email_send_log.template_name and the queue label for each step. */
export function comeBackTemplateName(step: ComeBackStep): string {
  return `come_back_${step}`;
}

/** The sign-off. The owner confirms it before the switch is turned on. */
export const FOUNDER_NAME = "Lexi";

export interface ComeBackCopy {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  /** Paragraphs before the list (after "Hi <name>,"). */
  intro: string[];
  /** A short list after the paragraphs: [bold lead, the rest]. May be empty. */
  bullets: [string, string][];
  button: string;
  /** Line before the founder's name. */
  closing: string;
}

export const COME_BACK_COPY: Record<ComeBackStep, ComeBackCopy> = {
  1: {
    subject: "Can I help you get started?",
    preheader: "A quick note from the person who started Louisiana Helpr.",
    intro: [
      "I started Louisiana Helpr, and I saw you signed up a few days ago. Thank you for that.",
      "If something got in the way, I'd like to hear about it. Was anything confusing, or did you not find what you came for? Just reply to this email and tell me.",
      "If you're ready to give it a try, here's how it works:",
    ],
    bullets: [
      ["Need a hand?", "Describe the job and set your price. See who applied and chat before you hire."],
      ["Want work?", "Browse jobs near you, see your take-home, then apply."],
    ],
    button: "Open Louisiana Helpr",
    closing: "Thanks,",
  },
  2: {
    subject: "One last note from Louisiana Helpr",
    preheader: "This is the last one. Your account is here whenever you need it.",
    intro: [
      "I wrote last week to ask if anything got in the way. This is my last note, I promise.",
      "Your account is still here whenever you need it. The next time you have a job around the house, or want to pick up some local work, it's ready.",
      "And if Louisiana Helpr wasn't right for you, I'd really like to know what was missing. Just hit reply.",
    ],
    bullets: [],
    button: "Open Louisiana Helpr",
    closing: "Thanks for signing up,",
  },
};

/** "Hi Pat," from "Pat Smith"; "Hi there," when there is no name. */
export function comeBackGreeting(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return `Hi ${first || "there"},`;
}

/** Why the recipient got it, in the footer above the unsubscribe link. */
export const COME_BACK_REASON =
  "You're receiving this because you have a Louisiana Helpr account and agreed to emails from us.";
