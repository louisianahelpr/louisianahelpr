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
export const SENDER_DOMAIN = "louisianahelpr.com";

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
export const ReEngagementEmail = inert("ReEngagementEmail");
export const WelcomeDripStep1Email = inert("WelcomeDripStep1Email");
export const WelcomeDripStep2Email = inert("WelcomeDripStep2Email");
export const WelcomeDripStep3Email = inert("WelcomeDripStep3Email");
export const NotificationEmail = inert("NotificationEmail");

/** Every direct `sendWithResend(key, message)` call, in order (send-notification-email's fallback). */
export const sendWithResend = vi.fn(async (_key: string, _message: unknown) => ({ id: "resend-mock-id" }));

// auth-email-hook's templates (inert, like the ones above).
export const SignupEmail = inert("SignupEmail");
export const InviteEmail = inert("InviteEmail");
export const MagicLinkEmail = inert("MagicLinkEmail");
export const RecoveryEmail = inert("RecoveryEmail");
export const EmailChangeEmail = inert("EmailChangeEmail");
export const ReauthenticationEmail = inert("ReauthenticationEmail");

/** The preview endpoint's direct render; the webhook path goes through renderEmail. */
export const renderAsync = vi.fn(async (element: unknown) => {
  emailRenders.push(element);
  return "<p>mock</p>";
});

/**
 * `npm:standardwebhooks` double: a request signs as valid by carrying
 * `webhook-signature: valid`; anything else throws like a bad signature.
 */
export class Webhook {
  constructor(_secret: string) {}
  verify(body: string, headers: Record<string, string>): unknown {
    if (headers["webhook-signature"] !== "valid") throw new Error("bad signature");
    return JSON.parse(body);
  }
}
