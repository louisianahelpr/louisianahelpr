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

/** Every `renderEmail(...)` call, in order, with the element it was given. */
export const emailRenders: unknown[] = [];

export function resetEmailMocks() {
  emailRenders.length = 0;
}

export const buildUnsubscribeUrl = vi.fn(
  async (email: string): Promise<string | null> =>
    `https://app.test/unsubscribe?e=${encodeURIComponent(email)}`,
);

export const unsubscribeHeaders = vi.fn(async (recipientEmail?: string) => ({
  "List-Unsubscribe": `<https://app.test/unsubscribe?e=${encodeURIComponent(recipientEmail ?? "")}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
}));

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
export const ApprovalReminderEmail = inert("ApprovalReminderEmail");
export const ReEngagementEmail = inert("ReEngagementEmail");
export const WelcomeDripStep1Email = inert("WelcomeDripStep1Email");
export const WelcomeDripStep2Email = inert("WelcomeDripStep2Email");
export const WelcomeDripStep3Email = inert("WelcomeDripStep3Email");
