// ManualVerifyDialog — sixth extraction in the AdminUsers cleanup.
// Pure confirmation dialog for the "manually verify this user" admin
// action. Calls admin-user-actions with action='manual_verify'.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogCallout,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { ScrollText } from "lucide-react";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface ManualVerifyDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ManualVerifyDialog({ profile, onClose, onSuccess }: ManualVerifyDialogProps) {
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
          action: "manual_verify",
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
          title={`Manually Verify ${formatName(profile?.full_name)}`}
        />
        <div className="space-y-3">
          <DialogBody>
            <p>
              Use this for someone you know personally, or whose ID is valid but our system couldn't read it.
              Their identity status will be set to <strong className="text-foreground">verified</strong> and approval will be set to <strong className="text-foreground">approved</strong>, bypassing automated checks.
            </p>
          </DialogBody>
          {/* The SHARED notice box. This was a bespoke accent-tinted card —
              a third notice colour beside the sienna callout every other popup
              uses and the amber one EditJobDialog had. Copy unchanged. */}
          <DialogCallout icon={ScrollText}>
            This action is logged in the admin audit log.
          </DialogCallout>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose} disabled={busy}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction onClick={submit} disabled={busy}>
            {busy ? "Verifying…" : "Manually Verify"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
