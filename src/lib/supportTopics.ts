/**
 * Support topics — the ONE source of truth for the category a support
 * message is filed under.
 *
 * Two surfaces render these, and they must stay in lockstep or the product
 * reads as two different support systems:
 *
 *   • `src/components/profile/SupportInline.tsx` — the signed-in Profile
 *     tab. Renders the topics as a 2×2 card grid (each card also carries a
 *     lucide icon, attached there because this module stays JSX-free).
 *   • `src/pages/Support.tsx` — the public `/support` page, reachable
 *     signed-OUT. Renders the same topics as a <Select>.
 *
 * `reportLabel` is the prefix written onto the ticket (`reports.reason` for
 * the authed path, the email subject for the guest path) so admins can
 * triage by scanning one column.
 *
 * NOTE: `supabase/functions/contact-support/index.ts` mirrors the key →
 * reportLabel map. Edge functions run on Deno and cannot import from `src/`,
 * so that copy is deliberate — change both together.
 */

export type SupportTopicKey = "message" | "suggestion" | "report" | "other";

export interface SupportTopic {
  key: SupportTopicKey;
  /** Card / option label. */
  label: string;
  /** One-line explanation under the label. */
  description: string;
  /** Placeholder for the message textarea, written for this topic so the
   *  form feels tailored rather than generic. */
  messagePlaceholder: string;
  /** Label for the message field itself ("Your idea", "What went wrong?"…). */
  messageLabel: string;
  /** Submit-button label tuned to the action. */
  submitLabel: string;
  /** Stored/emailed prefix so admins can triage faster. */
  reportLabel: string;
}

export const SUPPORT_TOPICS: readonly SupportTopic[] = [
  {
    key: "message",
    label: "Message Admin",
    description: "Send a message or ask the admin team a question",
    messagePlaceholder: "How can our team help you today?",
    messageLabel: "Your message",
    submitLabel: "Send Message",
    reportLabel: "Admin Message",
  },
  {
    key: "suggestion",
    label: "Suggestion",
    description: "Share an idea to improve the platform",
    messagePlaceholder: "Describe your idea to improve Helpr…",
    messageLabel: "Your idea",
    submitLabel: "Send Suggestion",
    reportLabel: "Suggestion",
  },
  {
    key: "report",
    label: "Report Issue",
    description: "Report a bug, problem, or concern",
    messagePlaceholder: "Please describe the bug or technical problem…",
    messageLabel: "What went wrong?",
    submitLabel: "Report Issue",
    reportLabel: "Issue Report",
  },
  {
    key: "other",
    label: "Other",
    description: "Something else we should know about",
    messagePlaceholder: "Tell us what's on your mind…",
    messageLabel: "Your message",
    submitLabel: "Send Message",
    reportLabel: "Other",
  },
] as const;

export const findSupportTopic = (
  key: string | null | undefined,
): SupportTopic | null =>
  SUPPORT_TOPICS.find((t) => t.key === key) ?? null;
