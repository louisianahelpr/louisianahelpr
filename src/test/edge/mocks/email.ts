/**
 * Test doubles for the transactional-email layer the lifecycle crons import.
 *
 * `engagement-automations` pulls in six modules that are pure I/O or pure
 * presentation: the Resend client (`_shared/resend.ts`), signed unsubscribe
 * links (`_shared/unsubscribe.ts`), the react-email renderer
 * (`_shared/email-templates/render.ts`) and the templates themselves
 * (`lifecycle.tsx`, `drip.tsx`). Rendering an MJML-ish React tree in a unit
 * test would exercise `@react-email/components` and prove nothing about the
 * cron — what is under test is WHO gets mailed and WHEN the run refuses to
 * mail at all, which is decided entirely before a template is touched.
 *
 * So the whole layer collapses to this module. `renderEmail` returns a fixed
 * body, `buildUnsubscribeUrl` returns a deterministic link, and every template
 * is an inert component: the function still calls `React.createElement` on the
 * right one with the right props, and `emailRenders` records that, so a test
 * can assert the correct template was selected without rendering it.
 */
import { vi } from "vitest";

/** Sender identity — one place, matching `_shared/resend.ts`'s contract. */
export const FROM_DEFAULT = "Louisiana Helpr <hello@louisianahelpr.com>";
/** Support replies (admin-support-reply): the team, never one admin. */
export const FROM_SUPPORT = "Louisiana Helpr Support <noreply@louisianahelpr.com>";

/** Every `renderEmail(...)` call, in order, with the element it was given. */
export const emailRenders: unknown[] = [];

/** Every `queueEmail(supabase, email)` call's email, in order (Declutter money emails, slice 3b). */
export const queuedEmails: Array<Record<string, unknown>> = [];

export function resetEmailMocks() {
  emailRenders.length = 0;
  queuedEmails.length = 0;
}

/** `_shared/resend.ts` queueEmail: records the email and reports it queued. */
export const queueEmail = vi.fn(async (_supabase: unknown, email: Record<string, unknown>) => {
  queuedEmails.push(email);
  return { ok: true, messageId: "queued-mock-id" };
});

export const buildUnsubscribeUrl = vi.fn(
  async (email: string): Promise<string | null> =>
    `https://app.test/unsubscribe?e=${encodeURIComponent(email)}`,
);

export const unsubscribeHeaders = vi.fn(async (recipientEmail?: string, list: "promotions" | "job_matches" = "promotions") => ({
  "List-Unsubscribe": `<https://app.test/unsubscribe?e=${encodeURIComponent(recipientEmail ?? "")}${list === "promotions" ? "" : `&list=${list}`}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
}));

/**
 * email-unsubscribe's side. A token "verifies" when its sig is `ok-<list>`, so
 * a test can hand the handler a link signed for one list and present it as
 * another. The real HMAC and its list scoping are tested directly against
 * `_shared/unsubscribe.ts` (src/test/edge/jobMatchListUnsubscribe.test.ts).
 * The harness rewrites `_shared/email.ts` imports to this file at load time
 * (harness.ts), which knip cannot follow.
 * @public
 */
export const verifyUnsubscribeToken = vi.fn(
  async (e: string | null, sig: string | null, list: "promotions" | "job_matches" = "promotions"): Promise<string | null> =>
    e && sig === `ok-${list}` ? e.toLowerCase() : null,
);
/** Harness-aliased (see verifyUnsubscribeToken). @public */
export const unsubscribeSigningConfigured = vi.fn(() => true);
/** Harness-aliased (see verifyUnsubscribeToken). @public */
export const unsubscribeListFrom = (value: string | null): "promotions" | "job_matches" =>
  value === "job_matches" ? "job_matches" : "promotions";
/** Harness-aliased (see verifyUnsubscribeToken). @public */
export const SUPPORT_EMAIL = "admin@louisianahelpr.test";
/** Harness-aliased (see verifyUnsubscribeToken). @public */
export const LOGO_URL = "https://app.test/logo.png";

export const renderEmail = vi.fn(async (element: unknown) => {
  emailRenders.push(element);
  return { html: "<p>mock</p>", text: "mock" };
});

/**
 * Inert template components. They are only ever passed to
 * `React.createElement`, never rendered, so an identity function is enough —
 * and the identity is what makes "did it pick the right drip step?" assertable
 * from `emailRenders[i].type`.
 */
const inert = (name: string) => {
  const c = () => null;
  Object.defineProperty(c, "name", { value: name });
  return c;
};

export const AdminDigestEmail = inert("AdminDigestEmail");
export const ReEngagementEmail = inert("ReEngagementEmail");
export const WelcomeDripStep1Email = inert("WelcomeDripStep1Email");
export const WelcomeDripStep2Email = inert("WelcomeDripStep2Email");
export const WelcomeDripStep3Email = inert("WelcomeDripStep3Email");
export const NotificationEmail = inert("NotificationEmail");
/** send-notification-email's button words: the REAL pure function (no Deno, no React), reached through the harness's template rewrite. @public */
export { notificationActionLabel } from "../../../../supabase/functions/_shared/email-templates/notificationAction";
export const SignupLeadReminderEmail = inert("SignupLeadReminderEmail");
/** admin-support-reply's template, reached through the harness rewrite. @public */
export const AdminActionEmail = inert("AdminActionEmail");
/**
 * come-back-emails' template. Reached only through the harness's template
 * rewrite (harness.ts), which knip cannot follow.
 * @public
 */
export const ComeBackEmail = inert("ComeBackEmail");

/** Every direct `sendWithResend(key, message)` call, in order (send-notification-email's fallback). */
export const sendWithResend = vi.fn(async (_key: string, _message: unknown) => ({ id: "resend-mock-id" }));

/** The per-send ceiling process-email-queue sizes its visibility timeout from (real value in _shared/resend.ts). Harness-aliased (see verifyUnsubscribeToken). @public */
export const SEND_TIMEOUT_MS = 10_000;

/**
 * process-email-queue derives a missing text part from the HTML; the double strips tags.
 * The strip repeats until nothing changes, like the real one in _shared/resend.ts: one pass
 * can join the text either side of a removed tag into a new tag (CodeQL
 * js/incomplete-multi-character-sanitization). Harness-aliased (see verifyUnsubscribeToken).
 * @public
 */
export const htmlToPlainText = (html: string): string => {
  let text = html;
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== prev);
  return text.trim();
};
