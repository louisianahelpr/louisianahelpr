/**
 * useAdminUserActions
 *
 * Stateless action callbacks for the admin user-management screen.
 * Extracted verbatim from AdminUsers.tsx — behaviour-preserving structural
 * refactor. Each function mutates Supabase directly, fires a toast, and
 * calls the loadProfiles / close-dialog callbacks provided by the parent.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
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
    // .select("id"): approval is the gate between "can't use the platform" and
    // "can". A zero-row update returns error === null, and this used to go on
    // to email the user that they were approved when nothing had changed.
    let approved = true;
    try {
      unwrapMutation(
        await supabase.from("profiles").update({
          approval_status: "approved",
          approval_email_count: 1,
          last_approval_email_at: new Date().toISOString(),
          // Clear denial info so re-approved users are fully removed from the Denied tab
          denial_reason: null,
          denial_email_count: 0,
          last_denial_email_at: null,
        }).eq("id", profile.id).select("id"),
        {
          action: "approve this account",
          rejectedMessage: "This account wasn't approved — nothing was changed. Check your admin permissions and try again.",
          context: { profileId: profile.id, targetUserId: profile.user_id },
        },
      );
    } catch (err) {
      approved = false;
      toast.error(mutationErrorMessage(err, "Couldn't approve that account — try again."));
    }
    if (approved) {
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

      try {
        unwrapMutation(
          await supabase.from("profiles").update({
            approval_email_count: (profile.approval_email_count || 0) + 1,
            last_approval_email_at: new Date().toISOString(),
          }).eq("id", profile.id).select("id"),
          { action: "record the approval-email resend" },
        );
      } catch (countErr) {
        report(countErr, { tags: { source: "AdminUsers.resendApprovalEmail.count" } });
      }

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
      try {
        unwrapMutation(
          await supabase.from("profiles").update({
            denial_email_count: (profile.denial_email_count || 0) + 1,
            last_denial_email_at: new Date().toISOString(),
          }).eq("id", profile.id).select("id"),
          { action: "record the denial-email resend" },
        );
      } catch (countErr) {
        report(countErr, { tags: { source: "AdminUsers.resendDenialEmail.count" } });
      }

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
    const { data: clearedBans, error: banErr } = await supabase
      .from("user_bans").update({ is_active: false })
      .eq("user_id", profile.user_id).eq("is_active", true)
      .select("id");
    if (banErr) {
      report(banErr, { tags: { source: "AdminUsers.unbanUser.userBans" } });
      toast.error(banErr.message || "Couldn't lift the ban — try again");
      return;
    }
    // Zero rows here is genuinely ambiguous, which is why this write could not
    // simply use `unwrapMutation`: `.eq("is_active", true)` legitimately
    // matches nothing when there is no active ban. But an RLS refusal produces
    // EXACTLY the same `{ data: [], error: null }` — verbatim the
    // AdminExceptionQueue bug, where the only non-owner policy was
    // `auth.role() = 'service_role'`, which never matches an admin JWT, so
    // writes affected zero rows while the queue reported success.
    //
    // That mattered more here than there, because the very next write IS
    // guarded and WOULD have succeeded: `profiles.ban_status` flips to
    // 'active' while the `user_bans` row stays `is_active = true`. A
    // HALF-LIFTED BAN — the app treats the account as active, the ban ledger
    // says it is banned, and the moderator was told it worked.
    //
    // So the ambiguity is resolved rather than assumed: if nothing was
    // updated, re-read for an active ban. A row still there means the update
    // was refused; nothing there means there was genuinely nothing to lift.
    if ((clearedBans ?? []).length === 0) {
      const { data: stillBanned, error: recheckErr } = await supabase
        .from("user_bans").select("id")
        .eq("user_id", profile.user_id).eq("is_active", true).limit(1);
      if (recheckErr || (stillBanned ?? []).length > 0) {
        report(recheckErr ?? new Error("user_bans update affected zero rows while an active ban remains"), {
          tags: { source: "AdminUsers.unbanUser.userBansRejected" },
          context: { targetUserId: profile.user_id },
        });
        toast.error("The ban wasn't lifted — the update was refused. Check your admin permissions and try again.");
        return;
      }
    }

    // .select("user_id"): `profiles.ban_status` is the flag the app actually
    // reads. A zero-row update here returns error === null and would report the
    // ban as lifted while the user stayed locked out.
    try {
      unwrapMutation(
        await supabase
          .from("profiles").update({ ban_status: "active" }).eq("user_id", profile.user_id)
          .select("user_id"),
        {
          action: "lift this ban",
          rejectedMessage: "Ban row cleared, but the account status didn't update — re-check this user.",
          context: { targetUserId: profile.user_id },
        },
      );
    } catch (profileErr) {
      if (!isWriteRejected(profileErr)) {
        report(profileErr, { tags: { source: "AdminUsers.unbanUser.profile" } });
      }
      toast.error(
        mutationErrorMessage(profileErr, "Ban row cleared, but the account status didn't update — re-check this user."),
      );
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
