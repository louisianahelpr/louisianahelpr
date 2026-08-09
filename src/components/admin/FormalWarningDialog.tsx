// FormalWarningDialog — ninth extraction in the AdminUsers cleanup.
// Logs a "manual strike" against a user via admin-user-actions with
// action='formal_warning'. Owns category + note + bypass-strike state.
//
// "Bypass next strike" lets admins record the incident in the audit
// trail without escalating to the next tier — useful when they've
// spoken to the user and decided it's a genuine one-time mistake.

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface FormalWarningDialogProps {
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function FormalWarningDialog({ profile, onClose, onSuccess }: FormalWarningDialogProps) {
  const [category, setCategory] = useState("conduct");
  const [note, setNote] = useState("");
  const [bypass, setBypass] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    if (busy) return;
    setCategory("conduct");
    setNote("");
    setBypass(false);
    onClose();
  };

  const submit = async () => {
    if (!profile || !note.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: "formal_warning",
          userId: profile.user_id,
          note,
          reasonCategory: category,
          bypassStrike: bypass,
        },
      });
      if (error) throw error;
      toast.success("Formal warning issued.");
      setCategory("conduct");
      setNote("");
      setBypass(false);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto p-5 sm:p-6 gap-5">
        <DialogHero
          eyebrow={
            <>
              <MessageSquareWarning className="w-3.5 h-3.5" /> Manual strike
            </>
          }
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="Issue Manual Strike"
        />
        <div className="space-y-5">
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Per the Repeat Offender Policy: <strong>1st</strong> = warning, <strong>2nd</strong> = final warning banner, <strong>3rd</strong> = 7-day suspension.
            This logs a strike, emails {formatName(profile?.full_name)}, and adds it to their violation history.
          </p>
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Reason category</p>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Reason category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conduct">Conduct (rude / disrespectful)</SelectItem>
                <SelectItem value="no_show">No-show / late cancellation</SelectItem>
                <SelectItem value="payment_policy">Payment policy (off-platform)</SelectItem>
                <SelectItem value="inappropriate_content">Inappropriate content</SelectItem>
                <SelectItem value="quality">Poor work quality</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Internal note (sent to user)</p>
            <Textarea
              aria-label="Internal note (sent to user)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customer complaint: helper left gate open. Verified via phone call."
              rows={3}
            />
          </div>
          <label className="flex items-start gap-2.5 rounded-ds-sm border border-border bg-secondary/30 p-3 cursor-pointer hover:bg-secondary/50 transition-colors">
            <Checkbox
              checked={bypass}
              onCheckedChange={(v) => setBypass(v === true)}
              className="mt-0.5 shrink-0"
            />
            <div className="space-y-1 min-w-0">
              <p className="text-ds-11 font-medium text-foreground">Bypass next strike (one-time courtesy)</p>
              <p className="text-ds-11 text-muted-foreground leading-relaxed">
                Logs the warning but does NOT escalate to the next tier. Use when you've spoken to them and decided this is a genuine one-time mistake.
              </p>
            </div>
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-border/40 -mx-5 sm:-mx-6 px-5 sm:px-6">
          <Button variant="ghost" onClick={handleClose} disabled={busy} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !note.trim()}
            className="w-full sm:w-auto"
          >
            {busy ? "Issuing…" : bypass ? "Issue (no escalation)" : "Issue Strike"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
