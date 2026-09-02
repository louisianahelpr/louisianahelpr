// ResetPasswordDialog — seventh extraction in the AdminUsers cleanup.
// Pure confirmation dialog for emailing a one-time password reset link.
// Calls admin-user-actions with action='reset_password'.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface ResetPasswordDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ResetPasswordDialog({ profile, onClose, onSuccess }: ResetPasswordDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: "reset_password",
          userId: profile.user_id,
          note: "",
          reasonCategory: "",
          bypassStrike: false,
        },
      });
      if (error) throw error;
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero
          title="Send Password Reset Link"
        />
        <div className="space-y-3">
          <DialogBody>
            <p>
              Email a one-time password reset link to{" "}
              <strong className="text-foreground">
                {(profile as { email?: string } | null)?.email || "this user"}
              </strong>
              . The link expires in 1 hour.
            </p>
          </DialogBody>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose} disabled={busy}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send Reset Link"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
