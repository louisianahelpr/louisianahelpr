// ReuploadIdDialog — eighth extraction in the AdminUsers cleanup.
// Sends the user a friendly email asking for a clearer ID photo,
// flips their idv_status to "action needed". Owns its own note + busy
// state.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface ReuploadIdDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ReuploadIdDialog({ profile, onClose, onSuccess }: ReuploadIdDialogProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    if (busy) return;
    setNote("");
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: "request_id_reupload",
          userId: profile.user_id,
          note: note || "",
          reasonCategory: "",
          bypassStrike: false,
        },
      });
      if (error) throw error;
      toast.success("ID re-upload request sent.");
      setNote("");
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
              <Camera className="w-3.5 h-3.5" /> ID re-upload
            </>
          }
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="Request ID Re-Upload"
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            Send {formatName(profile?.full_name)} a friendly email asking for a clearer ID photo.
            Their IDV status will be set to <strong className="text-foreground">action needed</strong>.
          </p>
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Note (optional)</p>
            <Textarea
              aria-label="Note to user (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Photo was too blurry — please retake in good lighting."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send Re-upload Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
