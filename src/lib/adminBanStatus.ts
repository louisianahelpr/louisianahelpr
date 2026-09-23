/**
 * setProfileBanStatus — the admin UI's only way to change
 * `profiles.ban_status` / `profiles.auto_suspended_until` (Q304).
 *
 * `authenticated` holds no column UPDATE on either any more (migration
 * revoke_profile_ban_column_updates), so the write goes through the
 * `admin-user-actions` edge function's `set_ban_status` action, which checks
 * the admin role server-side and writes with the service role.
 *
 * `suspendedUntil`: omit it to leave the column untouched, pass `null` to clear
 * it, or an ISO instant to set it (temp_banned only).
 *
 * Throws a `WriteRejectedError` carrying `rejectedMessage` when the server
 * matched no profile (the zero-row case `unwrapMutation` used to catch), and a
 * plain Error with the server's own reason for anything else — so callers keep
 * using `mutationErrorMessage` / `isWriteRejected` exactly as before.
 */
import { supabase } from "@/integrations/supabase/client";
import { WriteRejectedError } from "@/lib/mutationResult";
import { functionErrorBody } from "@/lib/supabaseResult";

export type AdminBanStatus = "active" | "final_warning" | "temp_banned" | "permanently_banned";

export async function setProfileBanStatus(opts: {
  userId: string;
  banStatus: AdminBanStatus;
  suspendedUntil?: string | null;
  rejectedMessage: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    action: "set_ban_status",
    userId: opts.userId,
    banStatus: opts.banStatus,
  };
  if (opts.suspendedUntil !== undefined) body.suspendedUntil = opts.suspendedUntil;

  const { data, error } = await supabase.functions.invoke("admin-user-actions", { body });
  if (error) {
    const errBody = await functionErrorBody(error);
    if (errBody?.rejected === true) throw new WriteRejectedError(opts.rejectedMessage, 0, 1);
    const reason = typeof errBody?.error === "string" && errBody.error.trim() ? errBody.error : null;
    throw new Error(reason ?? "Couldn't update this account's status — try again.");
  }
  if (!data || (data as { success?: unknown }).success !== true) {
    throw new WriteRejectedError(opts.rejectedMessage, 0, 1);
  }
}
