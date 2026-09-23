/**
 * Q139: the Q137 seed boundary, as seen by an edge-function producer.
 *
 * The notifications BEFORE INSERT trigger (trg_notifications_seed_boundary,
 * migration 20260923121354) DROPS a row whose subject is seed (a seed job, or a
 * seed actor named in the link) when its recipient is a real account. Since
 * Q139 every producer passes its subject, so for a seed job with a real party
 * the insert now returns ZERO rows BY DESIGN. A producer that reads zero rows
 * as a failed write (throws, records a defect, pages) must ask this first.
 *
 * Asked only AFTER a zero-row insert, so a real user's notification costs no
 * extra round trip and behaves exactly as before.
 */

export interface NotificationSubject {
  user_id: string;
  job_id?: string | null;
  link?: string | null;
}

/**
 * true  = the boundary drops this row (a seed subject to a real recipient):
 *         zero rows is the expected outcome, not a defect.
 * false = the boundary lets it through: zero rows IS a defect.
 * null  = the check itself could not answer: treat zero rows as a defect.
 * Same function and same arguments as the trigger (user_id, job_id, link).
 */
export async function seedBoundaryDropsRow(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: NotificationSubject,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("notification_crosses_seed_boundary", {
      p_recipient: row.user_id,
      p_job_id: row.job_id ?? null,
      p_link: row.link ?? null,
    });
    if (error || typeof data !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Q139: may a gift from `donorId` be EMAILED to its recipient?
 *
 * The gift email goes to an ADDRESS, not through the notifications table or
 * send-notification-email, so neither choke point sees it. The donor is its
 * subject. With a recipient account, the boundary is asked with the donor as
 * the actor (seed-to-seed stays allowed). With no account behind the address,
 * the recipient is an unknown person and is treated as REAL: a seed donor's
 * gift is not emailed.
 *
 * true = do not send. false = send. FAILS CLOSED: a check that cannot answer
 * returns true, the same side send-notification-email takes (Q159), because a
 * sent email cannot be recalled. The caller must make that refusal loud.
 */
export async function giftEmailCrossesSeedBoundary(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  donorId: string,
  recipientId: string | null,
): Promise<{ crosses: boolean; checkFailed: string | null }> {
  try {
    if (recipientId) {
      const { data, error } = await supabase.rpc("notification_crosses_seed_boundary", {
        p_recipient: recipientId,
        p_job_id: null,
        p_link: null,
        p_actor: donorId,
      });
      if (error || typeof data !== "boolean") {
        return { crosses: true, checkFailed: error?.message ?? "no boolean answer" };
      }
      return { crosses: data, checkFailed: null };
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("is_seed")
      .eq("user_id", donorId)
      .maybeSingle();
    if (error) return { crosses: true, checkFailed: error.message };
    return { crosses: data?.is_seed === true, checkFailed: null };
  } catch (e) {
    return { crosses: true, checkFailed: (e as Error).message ?? String(e) };
  }
}
