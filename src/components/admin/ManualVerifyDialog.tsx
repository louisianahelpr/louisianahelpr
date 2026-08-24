// ManualVerifyDialog — sixth extraction in the AdminUsers cleanup.
// Pure confirmation dialog for the "manually verify this user" admin
// action. Calls admin-user-actions with action='manual_verify'.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
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
          eyebrow={
            <>
              <ShieldCheck className="w-3.5 h-3.5" /> Manual verification
            </>
          }
          title={`Manually Verify ${formatName(profile?.full_name)}`}
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            Use this for someone you know personally, or whose ID is valid but our system couldn't read it.
            Their identity status will be set to <strong className="text-foreground">verified</strong> and approval will be set to <strong className="text-foreground">approved</strong>, bypassing automated checks.
          </p>
          <div className="rounded-ds-sm bg-accent/10 border border-accent/20 p-3">
            <p className="text-ds-11 text-muted-foreground">This action is logged in the admin audit log.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Verifying…" : "Manually Verify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
