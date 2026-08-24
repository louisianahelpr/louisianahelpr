/**
 * useAdminUserActions
 *
 * Stateless action callbacks for the admin user-management screen.
 * Extracted verbatim from AdminUsers.tsx — behaviour-preserving structural
 * refactor. Each function mutates Supabase directly, fires a toast, and
 * calls the loadProfiles / close-dialog callbacks provided by the parent.
 */
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { logAdminAction } from "@/lib/adminAudit";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import type { Profile } from "../adminUserHelpers";

interface ActionDeps {
  loadProfiles: () => void;
  setViewProfile: (p: Profile | null) => void;
  resending: string | null;
  setResending: (id: string | null) => void;
}

export const makeAdminUserActions = ({
  loadProfiles,
  setViewProfile,
  setResending,
}: ActionDeps) => {
  const approveUser = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({
      approval_status: "approved",
      approval_email_count: 1,
      last_approval_email_at: new Date().toISOString(),
      // Clear denial info so re-approved users are fully removed from the Denied tab
      denial_reason: null,
      denial_email_count: 0,
      last_denial_email_at: null,
    }).eq("id", profile.id);
    if (error) toast.error(error.message);
    else {
      await logAdminAction("approve_user", "user", profile.user_id, { name: profile.full_name });
      await createNotification({
        user_id: profile.user_id, title: "Account approved!",
        message: "Your account has been approved. You can now use the platform.",
        type: "success", link: "/dashboard",
      });
      // Send approval email
      supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "approved" },
      }).catch((err) => report(err, { tags: { source: "AdminUsers.sendApprovalEmail" } }));
      loadProfiles();
      setViewProfile(null);
    }
  };

  const resendApprovalEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { error } = await supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "approved" },
      });
      if (error) throw error;

      await supabase.from("profiles").update({
        approval_email_count: (profile.approval_email_count || 0) + 1,
        last_approval_email_at: new Date().toISOString(),
      }).eq("id", profile.id);

      loadProfiles();
    } catch (err: any) {
      toast.error("Couldn't resend that email — try again.");
      report(err, { tags: { source: "AdminUsers.resendApprovalEmail" } });
    } finally {
      setResending(null);
    }
  };

  const resendDenialEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { error } = await supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "denied", reason: profile.denial_reason || "" },
      });
      if (error) throw error;

      // Update count
      await supabase.from("profiles").update({
        denial_email_count: (profile.denial_email_count || 0) + 1,
        last_denial_email_at: new Date().toISOString(),
      }).eq("id", profile.id);

      loadProfiles();
    } catch (err: any) {
      toast.error("Couldn't resend that email — try again.");
      report(err, { tags: { source: "AdminUsers.resendDenialEmail" } });
    } finally {
      setResending(null);
    }
  };

  const resendVerificationEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-resend-verification", {
        body: { userId: profile.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      loadProfiles();
    } catch (err: any) {
      toast.error(err.message || "Couldn't resend the verification email — try again");
      report(err, { tags: { source: "AdminUsers.resendVerificationEmail" } });
    } finally {
      setResending(null);
    }
  };

  const unbanUser = async (profile: Profile) => {
    // All three writes used to be fire-and-forget, followed by an
    // unconditional "User unbanned." If RLS or the network refused, the
    // moderator was told the ban was lifted while the user stayed banned —
    // and nothing anywhere recorded that it hadn't worked.
    //
    // The two state writes are ordered deliberately and each aborts: lifting
    // the `user_bans` row without clearing `profiles.ban_status` leaves the
    // account in a half-banned state, so a failure on the second must be as
    // loud as a failure on the first.
    const { error: banErr } = await supabase
      .from("user_bans").update({ is_active: false })
      .eq("user_id", profile.user_id).eq("is_active", true);
    if (banErr) {
      report(banErr, { tags: { source: "AdminUsers.unbanUser.userBans" } });
      toast.error(banErr.message || "Couldn't lift the ban — try again");
      return;
    }

    const { error: profileErr } = await supabase
      .from("profiles").update({ ban_status: "active" }).eq("user_id", profile.user_id);
    if (profileErr) {
      report(profileErr, { tags: { source: "AdminUsers.unbanUser.profile" } });
      toast.error("Ban row cleared, but the account status didn't update — re-check this user.");
      loadProfiles();
      return;
    }

    // The user-facing notification is best-effort: the ban IS lifted at this
    // point, so a failed notify must not report the unban as failed. Reported,
    // not silent.
    const { error: notifyErr } = await supabase.from("notifications").insert({
      user_id: profile.user_id, title: "✅ Ban lifted",
      message: "Your account ban has been lifted. Please follow community guidelines going forward.",
      type: "success", link: "/dashboard",
    });
    if (notifyErr) report(notifyErr, { tags: { source: "AdminUsers.unbanUser.notify" } });

    loadProfiles();
    setViewProfile(null);
  };

  return { approveUser, resendApprovalEmail, resendDenialEmail, resendVerificationEmail, unbanUser };
};
