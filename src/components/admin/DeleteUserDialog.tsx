// DeleteUserDialog — fourth extraction in the AdminUsers cleanup.
// Permanent account deletion confirmation. Calls the admin-delete-user
// edge function. Owns its own deleting state.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
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

const CONFIRM_PHRASE = "DELETE";

export function DeleteUserDialog({ profile, onClose, onSuccess }: DeleteUserDialogProps) {
  const [deleting, setDeleting] = useState(false);
  // Q234: the most irreversible admin action gets the same typed confirm the
  // user's own Delete Account uses (biometry only gates it on device).
  const [confirmText, setConfirmText] = useState("");

  const handleClose = () => {
    if (deleting) return;
    setConfirmText("");
    onClose();
  };

  const submit = async () => {
    if (!profile || confirmText !== CONFIRM_PHRASE) return;
    // Face ID / Touch ID gate: this permanently destroys an account and all its
    // data — the single most irreversible action in the admin console. No-op on
    // web. On device it prompts whenever the device can authenticate its owner at
    // all — falling back to the passcode when biometry is unavailable or locked out
    // (see requireBiometric).
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
      setConfirmText("");
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
          <DialogBody>
            <p>
              Are you sure you want to permanently delete{" "}
              <strong className="text-foreground">{formatName(profile?.full_name)}</strong>'s account?
            </p>
          </DialogBody>
          <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
            <p className="text-ds-11 text-[hsl(var(--destructive-ink))] flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              This action is permanent and cannot be undone. All user data will be removed.
            </p>
          </div>
          <p className="text-ds-13 text-muted-foreground">
            Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> below to confirm.
          </p>
          <Input
            aria-label={`Type ${CONFIRM_PHRASE} to confirm deleting this account`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            className="h-11 text-center font-mono tracking-wide rounded-ds-md"
            disabled={deleting}
          />
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose} disabled={deleting}>
            Cancel
          </DialogSecondaryAction>
          <DialogDestructiveAction onClick={submit} disabled={deleting || confirmText !== CONFIRM_PHRASE}>
            {deleting ? "Deleting…" : "Delete Permanently"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
