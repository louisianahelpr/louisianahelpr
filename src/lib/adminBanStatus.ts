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
}): Promise<{ appliedBanStatus: string | null; appliedSuspendedUntil: string | null }> {
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
  // Q1413: a lift can keep a standing earned during a ban review; callers
  // name what was applied rather than assume their own choice.
  const d = data as { appliedBanStatus?: unknown; appliedSuspendedUntil?: unknown };
  return {
    appliedBanStatus: typeof d.appliedBanStatus === "string" ? d.appliedBanStatus : null,
    appliedSuspendedUntil: typeof d.appliedSuspendedUntil === "string" ? d.appliedSuspendedUntil : null,
  };
}

export type AdminAccountAction = "warning" | "temporary" | "permanent";

/**
 * applyAdminAccountAction — BanDialog's warning / temporary / permanent ban
 * (Q1494). The standing, the user_bans row and the strike are written by ONE
 * database transaction (`admin_apply_account_action`, via the
 * `admin-user-actions` edge function's `apply_account_action`), which refuses
 * an open ban settlement review before writing anything. The three used to be
 * separate requests, and a review opened between them left a ban row and a
 * strike behind a refused status write.
 *
 * Throws a `WriteRejectedError` carrying `rejectedMessage` when the server
 * matched no profile, and a plain Error with the server's own reason otherwise
 * (an open review included).
 */
export async function applyAdminAccountAction(opts: {
  userId: string;
  action: AdminAccountAction;
  reason: string;
  suspendedUntil?: string;
  rejectedMessage: string;
}): Promise<{ appliedBanStatus: string | null; appliedSuspendedUntil: string | null }> {
  const body: Record<string, unknown> = {
    action: "apply_account_action",
    userId: opts.userId,
    kind: opts.action,
    reason: opts.reason,
  };
  if (opts.suspendedUntil !== undefined) body.suspendedUntil = opts.suspendedUntil;

  const { data, error } = await supabase.functions.invoke("admin-user-actions", { body });
  if (error) {
    const errBody = await functionErrorBody(error);
    if (errBody?.rejected === true) throw new WriteRejectedError(opts.rejectedMessage, 0, 1);
    const reason = typeof errBody?.error === "string" && errBody.error.trim() ? errBody.error : null;
    throw new Error(reason ?? "Couldn't apply that action — try again.");
  }
  if (!data || (data as { success?: unknown }).success !== true) {
    throw new WriteRejectedError(opts.rejectedMessage, 0, 1);
  }
  const d = data as { appliedBanStatus?: unknown; appliedSuspendedUntil?: unknown };
  return {
    appliedBanStatus: typeof d.appliedBanStatus === "string" ? d.appliedBanStatus : null,
    appliedSuspendedUntil: typeof d.appliedSuspendedUntil === "string" ? d.appliedSuspendedUntil : null,
  };
}
