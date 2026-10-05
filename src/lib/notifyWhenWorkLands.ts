import { supabase } from "@/integrations/supabase/client";
import { signupUrlFor } from "@/lib/jobIntent";

/**
 * "Notify Me When Work Lands" is PUSH ONLY (owner, 2026-10-05, Q1313): no email
 * list, no new table, no sender of our own. The button does two things for a
 * signed-in member: turn the job-match push preference on, and ask the device
 * for push permission. The pings themselves are the job-match fan-out that
 * already exists (notify_helpers_on_job_post / the daily digest), which honours
 * these same two columns.
 *
 * For a signed-out visitor the button goes to quick sign-up with
 * `?reason=notify`, which the signup page words as "Sign up to get notified".
 */

/** Columns written on tap. Only these two: the upsert leaves every other
 *  preference exactly as the member set it (a first row takes DB defaults). */
export const NOTIFY_PREF_PATCH = { push_enabled: true, job_matches: true } as const;

/** Signed-out destination: quick sign-up, back to the jobs feed afterwards. */
export const NOTIFY_SIGNUP_URL = `${signupUrlFor("/jobs")}&reason=notify`;

/** The one line the signup page shows when the visitor arrived from the button. */
export const NOTIFY_SIGNUP_SUBTITLE = "Sign up to get notified when paid work lands.";

/** True when a signup URL's `reason` query value came from the Notify button. */
export function isNotifySignupReason(reason: string | null | undefined): boolean {
  return reason === "notify";
}

/**
 * Save the preference. Throws on a Supabase error or a write that stored
 * nothing (a null error is not a write), so the caller can say so instead of
 * toasting success over a row that never changed.
 */
export async function saveNotifyPreference(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, ...NOTIFY_PREF_PATCH }, { onConflict: "user_id" })
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("notification preference was not saved");
  }
}
