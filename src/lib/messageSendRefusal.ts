/**
 * What a refused message INSERT means, read from the error the server raised
 * (Q998).
 *
 * Before this, every refusal not explained by the thread-state checks in
 * sendHandlers fell into one bucket: "Message didn't go through — tap it to try
 * again" and a "Not Sent — Tap to Retry" bubble. For the send limit
 * (public.enforce_message_rate: 30 of the sender's own messages in a rolling
 * hour) that said nothing about why, and an immediate retry hits the same
 * limit. For the block, ban and unconfirmed-email triggers a retry can never
 * work at all.
 *
 * Each pattern below is the EXACT text a trigger on public.messages raises;
 * src/test/messageSendRefusalsClassified.test.ts reads every raising INSERT
 * trigger the migrations leave on messages and fails when one is neither
 * classified here nor explained as unreachable from the composer.
 */

export type SendRefusalKind = "rate_limited" | "blocked" | "account_restricted" | "email_unconfirmed";

export interface SendRefusal {
  kind: SendRefusalKind;
  /** True when the same send can succeed later (the bubble keeps tap-to-retry). */
  retryable: boolean;
  /** The toast shown when the send is refused. */
  toast: string;
}

/** Raised by public.enforce_message_rate (P0001). */
const RATE_LIMIT_RAISE = /You are sending messages too quickly/i;

const RATE_LIMITED_TOAST =
  "You've hit the hourly message limit. Wait a little while, then tap the message to try again.";

const RULES: { kind: SendRefusalKind; match: (msg: string) => boolean; retryable: boolean; toast: string }[] = [
  { kind: "rate_limited", match: (m) => RATE_LIMIT_RAISE.test(m), retryable: true, toast: RATE_LIMITED_TOAST },
  // public.enforce_block_on_message_insert (42501).
  {
    kind: "blocked",
    match: (m) => /You can'?t message this user/i.test(m),
    retryable: false,
    toast: "You can't message this person.",
  },
  // public.enforce_ban_gate (42501, HINT names /account-banned).
  {
    kind: "account_restricted",
    match: (m) => /^\s*account_restricted\b/.test(m),
    retryable: false,
    toast: "Your account is restricted, so messages can't be sent.",
  },
  // public.refuse_unconfirmed_email_write (42501).
  {
    kind: "email_unconfirmed",
    match: (m) => /^\s*email_unconfirmed\b/.test(m),
    retryable: false,
    toast: "Confirm your email address before sending messages.",
  },
];

/** The bubble's "Not Sent" line for a classified refusal. */
export const REFUSAL_BUBBLE_LABEL: Record<SendRefusalKind, string> = {
  rate_limited: "Not Sent — Hourly Limit. Tap to Retry Later",
  blocked: "Not Sent — Can't Message This Person",
  account_restricted: "Not Sent — Account Restricted",
  email_unconfirmed: "Not Sent — Confirm Your Email",
};

export function classifySendRefusal(error: { code?: string; message?: string } | null | undefined): SendRefusal | null {
  const msg = error?.message ?? "";
  if (!msg) return null;
  for (const r of RULES) {
    if (r.match(msg)) return { kind: r.kind, retryable: r.retryable, toast: r.toast };
  }
  return null;
}
