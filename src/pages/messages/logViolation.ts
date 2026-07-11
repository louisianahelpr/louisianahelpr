import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

/**
 * Records an off-platform-contact violation for the current user, escalating
 * to a permanent ban on a repeat offence and notifying admins either way.
 * Extracted verbatim from Messages.tsx — takes the current user id and the
 * cached auth user (for the sender's display name) rather than closing over
 * component state.
 */
export const logViolation = async (
  userId: string | null,
  cachedUser: { user_metadata?: { full_name?: string } } | null | undefined,
  violationDescription: string,
  blockedContent: string,
) => {
  if (!userId) return;
  const senderName = cachedUser?.user_metadata?.full_name || "A user";

  const { data: existing, error: existingError } = await supabase
    .from("user_violations")
    .select("id")
    .eq("user_id", userId)
    .eq("violation_type", "off_platform");
  // A failed prior-count read previously fell through to priorCount=0,
  // silently downgrading a repeat offence to a first warning. Surface it.
  if (existingError) report(existingError, { severity: "warning", tags: { source: "Messages.logViolation.priorCount" } });

  const priorCount = existing?.length || 0;

  if (priorCount >= 1) {
    // A silently-failed ban write leaves a repeat offender unbanned while we
    // tell them they're banned — surface both writes so a stuck ban is visible.
    const { error: banInsertError } = await supabase.from("user_bans").insert({
      user_id: userId, ban_type: "permanent",
      reason: "Repeated off-platform activity: " + violationDescription, banned_by: userId,
    });
    if (banInsertError) report(banInsertError, { severity: "error", tags: { source: "Messages.logViolation.banInsert" } });
    const { error: banStatusError } = await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", userId);
    if (banStatusError) report(banStatusError, { severity: "error", tags: { source: "Messages.logViolation.banStatus" } });
    const { error: banViolationError } = await supabase.from("user_violations").insert({
      user_id: userId, violation_type: "off_platform",
      description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "permanent_ban",
    });
    if (banViolationError) report(banViolationError, { severity: "warning", tags: { source: "Messages.logViolation.banViolationRecord" } });
    const { data: adminRoles, error: adminRolesError } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    if (adminRolesError) report(adminRolesError, { severity: "warning", tags: { source: "Messages.logViolation.adminNotify" } });
    if (adminRoles?.length) {
      await supabase.from("notifications").insert(
        adminRoles.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          title: "⛔ User permanently banned",
          message: `${senderName} was auto-banned for repeated off-platform activity. They tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
          type: "warning",
          link: `/admin?view=reports`,
          read: false,
        })),
      );
    }
    toast.error("Your account is banned. Contact admin@louisianahelpr.com if you think this was a mistake.");
  } else {
    // This violation row is what makes the NEXT offence escalate to a ban —
    // a silent failure here means the offender never accrues a prior count.
    const { error: warnViolationError } = await supabase.from("user_violations").insert({
      user_id: userId, violation_type: "off_platform",
      description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "warning",
    });
    if (warnViolationError) report(warnViolationError, { severity: "warning", tags: { source: "Messages.logViolation.warnViolationRecord" } });
    const { error: warnStatusError } = await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", userId);
    if (warnStatusError) report(warnStatusError, { severity: "warning", tags: { source: "Messages.logViolation.warnStatus" } });
    const { data: adminRoles, error: adminRolesError } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    if (adminRolesError) report(adminRolesError, { severity: "warning", tags: { source: "Messages.logViolation.adminNotify" } });
    if (adminRoles?.length) {
      await supabase.from("notifications").insert(
        adminRoles.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          title: "⚠️ Off-platform attempt detected",
          message: `${senderName} tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
          type: "warning",
          link: `/admin?view=reports`,
          read: false,
        })),
      );
    }
  }
};
