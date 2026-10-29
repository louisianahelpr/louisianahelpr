import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { captchaRefusal } from "@/lib/turnstile";

/**
 * Prove it is really you, just before an account is deleted (A3-I5, owner
 * 2026-10-29: "asks for the password").
 *
 * Each call that succeeds starts a NEW session whose sign-in time is now;
 * delete-own-account refuses a token whose newest sign-in is older than ten
 * minutes (supabase/functions/_shared/recentSignIn.ts). A wrong password or
 * code leaves the current session as it was.
 *
 * Members with no password (signed up with Google or Apple: 34 of 308 live
 * accounts on 2026-10-29, measured in auth.users) are not locked out: they get
 * a 6-digit code by email instead, and so does anyone who forgot theirs.
 * The code arrives in the "magiclink" email (auth-email-hook), which shows the
 * code and no link: a mail scanner opening a link would spend the code.
 *
 * Imported by DeleteAccountReauth.tsx, which renders the <TurnstileField> the
 * captcha tokens come from (src/test/emailAuthCaptchaToken.test.ts).
 */

/** Does this account have a password to type? */
export function hasPasswordSignIn(user: Pick<User, "identities"> | null | undefined): boolean {
  // Measured 2026-10-29: every live account with an "email" identity has a
  // password (273 of 273); the 34 with only google/apple have none. Unknown
  // identities (null) default to the password field, with the code one tap away.
  const identities = user?.identities;
  if (!identities || identities.length === 0) return true;
  return identities.some((i) => i.provider === "email");
}

export type ReauthResult = { ok: true } | { ok: false; message: string };

export async function reauthWithPassword(email: string, password: string, captchaToken: string | undefined): Promise<ReauthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (!error) return { ok: true };
  const captcha = captchaRefusal(error.message);
  if (captcha) return { ok: false, message: captcha };
  if (/invalid login credentials/i.test(error.message)) {
    return { ok: false, message: "That password isn't right. Try again, or get a code by email." };
  }
  return { ok: false, message: "We couldn't check your password. Try again, or get a code by email." };
}

export async function sendDeleteCode(email: string, captchaToken: string | undefined): Promise<ReauthResult> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
  if (!error) return { ok: true };
  const captcha = captchaRefusal(error.message);
  if (captcha) return { ok: false, message: captcha };
  if (/rate limit|security purposes|seconds/i.test(error.message)) {
    return { ok: false, message: "A code was sent a moment ago. Wait a minute, then ask again." };
  }
  return { ok: false, message: "We couldn't send the code. Try again in a minute." };
}

export async function verifyDeleteCode(email: string, code: string): Promise<ReauthResult> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if (!error) return { ok: true };
  return { ok: false, message: "That code isn't right or has expired. Check the email, or send a new code." };
}
