// ResetPasswordDialog — seventh extraction in the AdminUsers cleanup.
// Pure confirmation dialog for emailing a one-time password reset link.
// Calls admin-user-actions with action='reset_password'.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";
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
      toast.success("Password reset email sent.");
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
          eyebrow={
            <>
              <KeyRound className="w-3.5 h-3.5" /> Password reset
            </>
          }
          title="Send Password Reset Link"
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            Email a one-time password reset link to{" "}
            <strong className="text-foreground">
              {(profile as { email?: string } | null)?.email || "this user"}
            </strong>
            . The link expires in 1 hour.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send Reset Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
