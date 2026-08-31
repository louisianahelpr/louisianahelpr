// EditEmailDialog — fifth extraction in the AdminUsers cleanup.
// Admin tool for changing a user's login email. Calls the
// admin-update-email edge function with double-confirmation match check.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { requireBiometric } from "@/lib/biometricGate";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface EditEmailDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditEmailDialog({ profile, onClose, onSuccess }: EditEmailDialogProps) {
  const [email1, setEmail1] = useState("");
  const [email2, setEmail2] = useState("");
  const [updating, setUpdating] = useState(false);

  const handleClose = () => {
    if (updating) return;
    setEmail1("");
    setEmail2("");
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    if (email1 !== email2) {
      toast.error("Emails don't match.");
      return;
    }
    if (!email1.trim()) {
      toast.error("Add a new email address.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email1)) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }

    // Face ID / Touch ID gate: repointing a user's login email is a complete
    // account-takeover primitive — the new address owns password reset from
    // that moment on. Same tier as ban/delete. Runs after validation so a
    // rejected form never raises an OS prompt. No-op on web and on devices
    // without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric("Confirm changing this user's login email");
    if (!ok) return;

    setUpdating(true);
    try {
      const { error } = await supabase.functions.invoke("admin-update-email", {
        body: { userId: profile.user_id, newEmail: email1.trim() },
      });
      if (error) throw error;
      setEmail1("");
      setEmail2("");
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string; context?: { json?: () => Promise<{ error?: string }> } };
      let message = e?.message || "Couldn't update email — try again";
      if (e?.context && typeof e.context.json === "function") {
        try {
          const body = await e.context.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep fallback message */
        }
      }
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero
          title={`Change Email for ${profile?.full_name || "User"}`}
        />
        <div className="space-y-4">
          <div className="rounded-ds-sm bg-muted/50 border border-border p-3">
            <p className="text-ds-11 text-muted-foreground">
              Current email:{" "}
              <strong className="text-foreground">
                {(profile as { email?: string } | null)?.email || "—"}
              </strong>
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">New Email</p>
            <Input
              type="email"
              aria-label="New email"
              value={email1}
              onChange={(e) => setEmail1(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Confirm New Email</p>
            <Input
              type="email"
              aria-label="Confirm new email"
              value={email2}
              onChange={(e) => setEmail2(e.target.value)}
            />
            {email2 && email1 !== email2 && (
              <p className="text-ds-11 text-destructive">Emails don't match</p>
            )}
            {email2 && email1 === email2 && email1.length > 0 && (
              <p className="text-ds-11 text-primary">✓ Emails match</p>
            )}
          </div>

          <div className="rounded-ds-sm bg-accent/10 border border-accent/20 p-3">
            <p className="text-ds-11 text-muted-foreground">
              ⚠️ This will immediately update the user's login email. They'll be notified of the change.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={updating}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={updating || !email1 || email1 !== email2}>
            {updating ? "Updating…" : "Update Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
