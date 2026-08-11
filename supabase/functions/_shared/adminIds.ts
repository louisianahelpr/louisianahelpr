/**
 * Load the user_ids of every admin, for fan-out of ops notifications.
 *
 * Exists because this lookup was hand-rolled in ~8 money paths as:
 *
 *   const { data: adminRoles } = await supabase
 *     .from("user_roles").select("user_id").eq("role", "admin");
 *   for (const admin of adminRoles ?? []) { ...notify... }
 *
 * — which drops the error. On ANY read failure `adminRoles` is null, `?? []`
 * makes it an empty list, and the loop silently notifies nobody. Every one of
 * those call sites is an alert about money going wrong (payout blocked, refund
 * failed, chargeback opened, dispute auto-resolved), so a swallowed error there
 * means the one signal that something needs a human is the thing that vanishes.
 *
 * This helper cannot make the notification succeed, but it guarantees the
 * failure is LOUD rather than an empty array: it logs with the caller's tag and
 * returns an explicit `ok` flag so callers can escalate (e.g. postSlackOpsAlert)
 * instead of quietly moving on.
 */
export interface AdminIdsResult {
  /** False when the lookup itself failed — NOT the same as "no admins exist". */
  ok: boolean;
  /** Admin user_ids. Empty on failure, and also empty if there genuinely are none. */
  ids: string[];
}

// deno-lint-ignore no-explicit-any
export async function loadAdminIds(supabase: any, source: string): Promise<AdminIdsResult> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (error) {
    console.error(
      `[${source}] FAILED to load admin ids — ops alerts for this event were NOT sent:`,
      error.message,
    );
    return { ok: false, ids: [] };
  }

  const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);

  if (ids.length === 0) {
    console.error(
      `[${source}] admin id lookup succeeded but returned ZERO admins — ops alerts for this event reached nobody.`,
    );
  }

  return { ok: true, ids };
}
