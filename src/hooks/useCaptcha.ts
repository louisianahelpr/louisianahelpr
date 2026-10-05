import { useCallback, useRef } from "react";
import type { TurnstileHandle } from "@/components/auth/TurnstileField";

/**
 * The ref for a <TurnstileField> plus `run`, which wraps one email-auth call
 * (Q1314): fetch the token, make the call with it, then reset the widget —
 * Turnstile tokens are single-use, so every attempt arms a fresh one, success
 * or failure. `captchaToken` is undefined while the widget is off (dormant).
 *
 *   const captcha = useCaptcha();
 *   const { error } = await captcha.run((captchaToken) =>
 *     supabase.auth.resetPasswordForEmail(email, { redirectTo, captchaToken }));
 *   <TurnstileField ref={captcha.ref} action="password_reset" />
 */
export function useCaptcha() {
  const ref = useRef<TurnstileHandle>(null);
  const run = useCallback(async <T,>(call: (captchaToken: string | undefined) => Promise<T>): Promise<T> => {
    const token = (await ref.current?.getToken()) ?? undefined;
    try {
      return await call(token);
    } finally {
      ref.current?.reset();
    }
  }, []);
  return { ref, run };
}
