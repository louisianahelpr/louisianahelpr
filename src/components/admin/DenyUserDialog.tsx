// DenyUserDialog — extracted from AdminUsers.tsx as the second step
// of breaking up that 2,345-line god component (after AutoRestrictedRail).
//
// Self-contained: owns its own reason/saving state. Parent passes the
// target profile and an onSuccess callback (typically: refetch profile
// list + close any parent profile detail dialog). Calling onClose with
// null also dismisses.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface DenyUserDialogProps {
  /** Target profile to deny. When null, the dialog is closed. */
  profile: Profile | null;
  /** Called whenever the dialog should close (Cancel, Esc, success). */
  onClose: () => void;
  /** Called after a successful deny — typically refetch profile list. */
  onSuccess?: () => void;
}

export function DenyUserDialog({ profile, onClose, onSuccess }: DenyUserDialogProps) {
  const [reason, setReason] = useState("");
  const [denying, setDenying] = useState(false);

  const handleClose = () => {
    if (denying) return;
    setReason("");
    onClose();
  };

  const denyUser = async () => {
    if (!profile) return;
    setDenying(true);
    // .select("id"): a denial that matches zero rows returns error === null,
    // and this used to go on to notify and email the applicant about a decision
    // the profile never recorded.
    try {
      unwrapMutation(
        await supabase
          .from("profiles")
          .update({
            approval_status: "denied",
            denial_reason: reason.trim() || null,
            denial_email_count: 1,
            last_denial_email_at: new Date().toISOString(),
          })
          .eq("id", profile.id)
          .select("id"),
        {
          action: "deny this account",
          rejectedMessage: "This account wasn't denied — nothing was changed. Check your admin permissions and try again.",
          context: { profileId: profile.id, targetUserId: profile.user_id },
        },
      );
    } catch (err) {
      toast.error(mutationErrorMessage(err, "Couldn't deny that account — try again."));
      setDenying(false);
      return;
    }

    await logAdminAction("deny_user", "user", profile.user_id, {
      name: profile.full_name,
      reason: reason.trim(),
    });
    await createNotification({
      user_id: profile.user_id,
      title: "Account not approved",
      message: reason.trim()
        ? `Your account was not approved. Reason: ${reason.trim()}`
        : "Your account was not approved. Please contact support for details.",
      type: "warning",
      link: "/profile",
    });
    // Branded denial email — non-blocking; report on failure.
    supabase.functions
      .invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "denied", reason: reason.trim() },
      })
      .catch((err) => report(err, { tags: { source: "DenyUserDialog.sendDenialEmail" } }));

    setDenying(false);
    setReason("");
    onSuccess?.();
    onClose();
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero
          title={`Deny ${formatName(profile?.full_name)}`}
        />
        <div className="space-y-4">
          <p className="text-ds-11 text-muted-foreground">
            Provide a reason for denying this application.
          </p>
          <Textarea
            aria-label="Reason for denial"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={denying}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={denyUser} disabled={denying}>
            {denying ? "Denying…" : "Deny User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
