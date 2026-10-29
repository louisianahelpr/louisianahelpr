import { useCallback, useRef } from "react";
import type { TurnstileHandle } from "@/components/auth/TurnstileField";
import { isCaptchaError } from "@/lib/turnstile";

/** True when an auth call's `{ error }` is GoTrue's captcha refusal. */
function refusedForCaptcha(result: unknown): boolean {
  const err = (result as { error?: { message?: unknown } | null } | null | undefined)?.error;
  return typeof err?.message === "string" && isCaptchaError(err.message);
}

/**
 * Make one email-auth call (Q1314) without ever holding it on a checkbox the
 * server may not check (A3-B1).
 *
 * The first try takes whatever token the widget has (it waits only while the
 * invisible check is still running, never on a visible box) and sends the
 * call, with or without one. Supabase Auth's captcha is OFF on purpose
 * (owner-approved 2026-10-15, Q2113), so that call simply goes through. Only
 * when the server answers with a captcha refusal does it wait for the person
 * to tick the box (`waitForCheckbox`, which shows "Tick the box to finish.")
 * and send once more with the fresh token. Tokens are single-use, so the
 * widget is re-armed after each one spent.
 *
 * This keeps the live captcha check (scripts/check-auth-captcha-matches-client.mjs)
 * coherent: a web build that ships the site key still sends a token whenever
 * Cloudflare minted one invisibly, and still sends one after any refusal, so
 * turning captcha ON together with VITE_TURNSTILE_ENABLED keeps working. The
 * check's rule is unchanged: key in the build <=> captcha ON on the server.
 */
export async function runWithCaptcha<T>(
  widget: TurnstileHandle | null | undefined,
  call: (captchaToken: string | undefined) => Promise<T>,
): Promise<T> {
  const attempt = async (token: string | null): Promise<T> => {
    try {
      return await call(token ?? undefined);
    } finally {
      // Re-arm only when a token was spent: resetting a box nobody needed to
      // tick would restart the challenge in front of the person.
      if (token) widget?.reset();
    }
  };
  const first = await attempt((await widget?.getToken()) ?? null);
  if (!widget || !refusedForCaptcha(first)) return first;
  const fresh = await widget.getToken({ waitForCheckbox: true });
  // No token to offer (widget off, failed, or the box was never ticked): the
  // refusal stands and the caller words it (recognizedAuthError).
  if (!fresh) return first;
  return attempt(fresh);
}

/**
 * The ref for a <TurnstileField> plus `run`, which wraps one email-auth call
 * in runWithCaptcha. `captchaToken` is undefined while the widget is off
 * (dormant) or has no token yet.
 *
 *   const captcha = useCaptcha();
 *   const { error } = await captcha.run((captchaToken) =>
 *     supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo, captchaToken }));
 *   <TurnstileField ref={captcha.ref} action="password_reset" />
 */
export function useCaptcha() {
  const ref = useRef<TurnstileHandle>(null);
  const run = useCallback(
    <T,>(call: (captchaToken: string | undefined) => Promise<T>): Promise<T> => runWithCaptcha(ref.current, call),
    [],
  );
  return { ref, run };
}
