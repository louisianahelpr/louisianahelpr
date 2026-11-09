/**
 * Support topics — the ONE source of truth for the category a support
 * message is filed under.
 *
 * Two surfaces render these, and they must stay in lockstep or the product
 * reads as two different support systems:
 *
 *   • `src/components/profile/SupportInline.tsx` — the signed-in Profile
 *     tab. Renders the topics in a <Select> (its items also carry a lucide
 *     icon, attached there because this module stays JSX-free).
 *   • `src/pages/info/Support.tsx` — the public `/support` page, reachable
 *     signed-OUT. Renders the same topics in the same <Select>.
 *
 * `reportLabel` is the prefix written onto the ticket (`reports.reason` for
 * the authed path, the email subject for the guest path) so admins can
 * triage by scanning one column.
 *
 * NINE topics since F042 (owner UI audit 11-09): the four below plus Declutter order, A job, Payments or payouts,
 * Can't log in and Report someone. `other` stays (owner, 2026-08-31, asked directly).
 *
 * `other` IS largely redundant with `message`, and it is worth writing down
 * why, so nobody "cleans it up" again:
 *   • Both carry the SAME `messageLabel` ("Your message") and the SAME
 *     `submitLabel` ("Send Message") — the form renders identically.
 *   • Both land in the same place: the authed path inserts the same
 *     `reports` row (`reported_type: 'support'`), the guest path emails the
 *     same `SUPPORT_EMAIL` inbox. Neither is routed or escalated differently.
 *   • `categoryFromReason` in `src/components/admin/AdminSupport.tsx` has a
 *     branch for `[Admin Message]` but NONE for `[Other]`, so an `Other`
 *     ticket shows in the admin queue under the generic "Support" label.
 *     There is no by-topic filter in that queue — only pending/resolved/all.
 * The owner was shown this and chose to keep all four anyway. That is a
 * product call, not an oversight: `Other` gives a person who cannot classify
 * their own problem somewhere to go, which matters more than a tidy enum.
 * DO NOT remove it without asking the owner again.
 *
 * Because four options do not sit evenly in a single chip row, BOTH surfaces
 * now present them through the same <Select> dropdown (owner: "just make it
 * a drop down how the public help and support does"). See SupportInline.
 *
 * NOTE: `supabase/functions/contact-support/index.ts` mirrors the key →
 * reportLabel map. Edge functions run on Deno and cannot import from `src/`,
 * so that copy is deliberate — change both together. It also still carries a
 * `help` key, a topic merged into `message` long ago, so bookmarked/in-flight
 * payloads keep validating.
 */

export type SupportTopicKey = "message" | "suggestion" | "report" | "other" | "declutter_order" | "job" | "payments" | "login" | "report_someone";

/** F042: the topics added 11-09. An older contact-support (before its deploy) refuses them; the form then files the
 *  message under "message" with the topic's label in front of the subject (supportFallbackPayload). */
export const NEW_SUPPORT_TOPIC_KEYS: readonly SupportTopicKey[] = ["declutter_order", "job", "payments", "login", "report_someone"];

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
    label: "Talk to a real person",
    description: "Ask our team anything. A person reads every message.",
    messagePlaceholder: "How can our team help you today?",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Admin Message",
  },
  {
    key: "suggestion",
    label: "Suggestion",
    description: "Share an idea to improve the platform",
    messagePlaceholder: "Describe your idea to improve Helpr…",
    messageLabel: "Your idea",
    submitLabel: "Send suggestion",
    reportLabel: "Suggestion",
  },
  {
    key: "report",
    // Owner, 2026-10-07 (Q1028): the bug topic reads "Something's not working";
    // it attaches the screen, route, device, build and recent errors.
    label: "Something's not working",
    description: "A bug, or something in the app that isn't working",
    messagePlaceholder: "Please describe the bug or technical problem…",
    messageLabel: "What went wrong?",
    submitLabel: "Report issue",
    reportLabel: "Issue Report",
  },
  // F042 (owner UI audit 11-09; lead go-ahead 11-09): the most common reasons to write in had no topic. Each files
  // under its own label (reportLabel, mirrored in supabase/functions/contact-support TOPIC_LABELS); "Other" stays.
  {
    key: "declutter_order",
    label: "Declutter order",
    description: "Something about an item you bought or sold",
    messagePlaceholder: "Which item, and what happened?",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Declutter Order",
  },
  {
    key: "job",
    label: "A job",
    description: "Something about a job you posted or worked",
    messagePlaceholder: "Which job, and what happened?",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Job",
  },
  {
    key: "payments",
    label: "Payments or payouts",
    description: "A charge, a refund or money on its way to you",
    messagePlaceholder: "What payment is this about, and what did you expect?",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Payments",
  },
  {
    key: "login",
    label: "Can't log in",
    description: "Trouble getting into your account",
    messagePlaceholder: "What happens when you try to log in?",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Login",
  },
  {
    key: "report_someone",
    label: "Report someone",
    description: "A member who broke the rules or made you feel unsafe",
    messagePlaceholder: "Who is it, and what happened? Add their name or a link to their profile if you can.",
    messageLabel: "Your message",
    submitLabel: "Send report",
    reportLabel: "Report Someone",
  },
  {
    key: "other",
    label: "Other",
    description: "Something else we should know about",
    messagePlaceholder: "Tell us what's on your mind…",
    messageLabel: "Your message",
    submitLabel: "Send message",
    reportLabel: "Other",
  },
] as const;

/**
 * How fast Louisiana Helpr answers (owner decided 2026-10-29, Q2478 part 3): the one promise Get help now and
 * both support "Message sent" states make. Was "usually within one business day" (/support) and "soon" (Profile).
 */
export const SUPPORT_REPLY_PROMISE = "We usually answer within a few hours.";

export const findSupportTopic = (
  key: string | null | undefined,
): SupportTopic | null =>
  SUPPORT_TOPICS.find((t) => t.key === key) ?? null;

/**
 * F042: while an older contact-support is still deployed (functions deploy on merge, a few minutes), it answers a new
 * topic with 400 "Choose what your message is about." The form then sends the same message once more under "message",
 * with the topic's label in front of the subject, so nothing a member wrote is lost. null for a topic the old function
 * already knows.
 */
export function supportFallbackPayload<T extends { topic: string; subject: string }>(body: T): T | null {
  const topic = findSupportTopic(body.topic);
  if (!topic || !NEW_SUPPORT_TOPIC_KEYS.includes(topic.key)) return null;
  // 120 = contact-support SUBJECT_MAX (review: the edge would otherwise cut the end of a long subject quietly).
  return { ...body, topic: "message", subject: `[${topic.label}] ${body.subject}`.slice(0, 120) };
}

/** The old function's refusal of an unknown topic (contact-support/index.ts). */
export const OLD_FUNCTION_TOPIC_REFUSAL = "Choose what your message is about.";
