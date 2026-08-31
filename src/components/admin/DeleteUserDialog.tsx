// DeleteUserDialog — fourth extraction in the AdminUsers cleanup.
// Permanent account deletion confirmation. Calls the admin-delete-user
// edge function. Owns its own deleting state.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { requireBiometric } from "@/lib/biometricGate";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface DeleteUserDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function DeleteUserDialog({ profile, onClose, onSuccess }: DeleteUserDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const handleClose = () => {
    if (deleting) return;
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    // Face ID / Touch ID gate: this permanently destroys an account and all
    // its data — the single most irreversible action in the admin console.
    // No-op on web and on devices without enrolled biometrics (see
    // requireBiometric), so an admin can never be locked out of the console.
    const ok = await requireBiometric("Confirm permanently deleting this account");
    if (!ok) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId: profile.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't delete that account — try again");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero
          title="Delete Account"
        />
        <div className="space-y-4">
          <p className="text-ds-11 text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <strong className="text-foreground">{formatName(profile?.full_name)}</strong>'s account?
          </p>
          <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
            <p className="text-ds-11 text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              This action is permanent and cannot be undone. All user data will be removed.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
