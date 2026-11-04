import { useCallback, useRef, type RefObject } from "react";
import type { TurnstileHandle } from "@/components/auth/TurnstileField";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { signupLeadSource } from "@/lib/signupLeadSource";

/**
 * Sign-up step-1 email capture (owner 2026-10-09, "Save it, follow up once").
 *
 * After step 1 passes validation the email (never the password) goes to the
 * record-signup-lead edge function, which saves it in public.signup_leads
 * (service_role only). If the visitor never finishes, signup-lead-reminders
 * sends ONE "Finish signing up" email after 24 hours.
 *
 * Fire-and-forget: this never throws and never blocks sign-up. A failure is
 * report()ed, except a 429 (the per-address rate limit doing its job) and a
 * 403 (the Turnstile bot check refusing the token, Q1589: also the check doing
 * its job; a widget that never loaded already shows its own retry line).
 */

/** Answers that are the server's checks working, not failures to report. */
const QUIET_STATUSES = new Set([403, 429]);

// Kept in its own module so the boot path (signupSource.ts, via SessionManager) does not carry this file
// (Q2705/Q2706 boot cut, 11-04). Re-exported for the existing callers.
export { signupLeadSource };

function statusOf(error: unknown): number | null {
  const ctx = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === "number" ? ctx.status : null;
}

/**
 * Save `email` as a lead. `replaces` is the address this visitor captured
 * earlier in the same sign-up (they went Back and corrected a typo): the
 * server drops that lead while it is fresh and untouched, so the typo is
 * never mailed.
 */
export async function captureSignupLead(
  email: string,
  source: string,
  replaces?: string | null,
  captchaToken?: string | null,
): Promise<void> {
  const next = email.trim().toLowerCase();
  const prev = replaces?.trim().toLowerCase() || null;
  try {
    const { error } = await supabase.functions.invoke("record-signup-lead", {
      body: {
        email: next,
        source,
        ...(prev && prev !== next ? { replaces: prev } : {}),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      },
    });
    if (error && !QUIET_STATUSES.has(statusOf(error) ?? 0)) {
      report(error, { tags: { source: "signupLead.capture" }, context: { status: statusOf(error) } });
    }
  } catch (err) {
    report(err, { tags: { source: "signupLead.capture" } });
  }
}

/**
 * Step 1's capture, for Signup.tsx: fire-and-forget (never awaited, never
 * blocks), and it remembers the address it last saved so a corrected typo
 * replaces it and the typo is never sent the reminder.
 *
 * `captchaRef` is the sign-up page's <TurnstileField> (Q1589): each capture
 * spends one token, and the widget is re-armed the moment the token is taken,
 * because tokens are single-use and step 2's signUp spends the next one.
 */
export function useSignupLeadCapture(captchaRef?: RefObject<TurnstileHandle | null>): (email: string) => void {
  const capturedLeadRef = useRef<string | null>(null);
  // Each save waits for the one before it (captureSignupLead never rejects).
  // Sent in parallel, a corrected address could reach the server first and
  // drop the typo's lead before the typo's own save arrived, and the typo
  // would then get the reminder.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  return useCallback((email: string) => {
    const replaces = capturedLeadRef.current;
    const source = signupLeadSource(window.location.search, document.referrer);
    capturedLeadRef.current = email;
    const widget = captchaRef?.current ?? null;
    const token: Promise<string | null> = widget
      ? widget.getToken().then(
          (t) => {
            widget.reset();
            return t;
          },
          () => null,
        )
      : Promise.resolve(null);
    queueRef.current = queueRef.current.then(() => token).then((t) => captureSignupLead(email, source, replaces, t));
  }, [captchaRef]);
}
