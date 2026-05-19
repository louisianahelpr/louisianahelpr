// BanDialog — third extraction in the AdminUsers cleanup. The 3-tier
// "take action" dialog (warning / temporary / permanent) is one of the
// largest self-contained chunks in AdminUsers. Owns its own type +
// reason + duration + saving state. Parent passes the target profile
// and an onSuccess callback (refetch + close any parent profile detail).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert, AlertTriangle, Clock, Ban } from "lucide-react";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { logAdminAction } from "@/lib/adminAudit";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type BanType = "warning" | "temporary" | "permanent";

interface BanDialogProps {
  /** Target profile. When null, the dialog is closed. */
  profile: Profile | null;
  /** Called whenever the dialog should close. */
  onClose: () => void;
  /** Called after successful ban — typically refetch profile list. */
  onSuccess?: () => void;
}

export function BanDialog({ profile, onClose, onSuccess }: BanDialogProps) {
  const [banType, setBanType] = useState<BanType>("warning");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("7");
  const [banning, setBanning] = useState(false);

  const handleClose = () => {
    if (banning) return;
    setReason("");
    setBanType("warning");
    setDuration("7");
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    if (!reason.trim()) {
      toast.error("Reason is required");
      return;
    }
    setBanning(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setBanning(false);
      return;
    }

    try {
      if (banType === "warning") {
        await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_warning",
          description: reason.trim(),
          action_taken: "warning",
          reported_by: user.id,
        });
        await supabase
          .from("profiles")
          .update({ ban_status: "final_warning" })
          .eq("user_id", profile.user_id);
        await createNotification({
          user_id: profile.user_id,
          title: "⚠️ Warning from Admin",
          message:
            reason.trim() ||
            "You have received a warning for violating platform rules. Another violation may result in a ban.",
          type: "warning",
          link: "/profile",
        });
        toast.success("Warning issued.");
        await logAdminAction("ban_user", "user", profile.user_id, {
          type: "warning",
          reason: reason.trim(),
        });
      } else if (banType === "temporary") {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(duration));
        await supabase.from("user_bans").insert({
          user_id: profile.user_id,
          ban_type: "temporary",
          reason: reason.trim(),
          banned_by: user.id,
          expires_at: expiresAt.toISOString(),
        });
        await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_action",
          description: reason.trim(),
          action_taken: "temp_ban",
          reported_by: user.id,
        });
        await supabase
          .from("profiles")
          .update({ ban_status: "temp_banned" })
          .eq("user_id", profile.user_id);
        await createNotification({
          user_id: profile.user_id,
          title: "🚫 Temporary Ban",
          message: `Your account has been temporarily banned for ${duration} days. Reason: ${reason.trim() || "Platform rule violation."}`,
          type: "warning",
          link: "/profile",
        });
        toast.success(`User temporarily banned for ${duration} days.`);
      } else {
        await supabase.from("user_bans").insert({
          user_id: profile.user_id,
          ban_type: "permanent",
          reason: reason.trim(),
          banned_by: user.id,
        });
        await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_action",
          description: reason.trim(),
          action_taken: "permanent_ban",
          reported_by: user.id,
        });
        await supabase
          .from("profiles")
          .update({ ban_status: "permanently_banned" })
          .eq("user_id", profile.user_id);
        await createNotification({
          user_id: profile.user_id,
          title: "⛔ Account Permanently Banned",
          message: `Your account has been permanently banned. Reason: ${reason.trim() || "Severe platform rule violation."}`,
          type: "warning",
          link: "/profile",
        });
        toast.success("User permanently banned.");
      }

      onSuccess?.();
      handleClose();
    } catch (err) {
      toast.error((err as Error).message || "Failed to take action");
    } finally {
      setBanning(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-5 sm:p-6 gap-5">
        <DialogHeader className="pr-8 space-y-1">
          <DialogTitle className="font-display flex items-center gap-2 text-ds-15 sm:text-ds-17">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
            <span className="truncate">Take Action: {profile?.full_name || "User"}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Action type</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "warning", label: "Warning", icon: <AlertTriangle className="w-4 h-4" />, color: "border-accent/40 bg-accent/10" },
                  { key: "temporary", label: "Temp Ban", icon: <Clock className="w-4 h-4" />, color: "border-destructive/40 bg-destructive/10" },
                  { key: "permanent", label: "Perm Ban", icon: <Ban className="w-4 h-4" />, color: "border-destructive/60 bg-destructive/20" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setBanType(opt.key)}
                  className={`p-2.5 rounded-ds-md border text-center space-y-1 transition-colors ${
                    banType === opt.key ? opt.color : "border-border bg-card hover:bg-secondary/30"
                  }`}
                >
                  <div className="flex justify-center">{opt.icon}</div>
                  <p className="text-ds-11 font-medium">{opt.label}</p>
                </button>
              ))}
            </div>
          </div>

          {banType === "temporary" && (
            <div className="space-y-2">
              <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Duration (days)</p>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">48 hours (2 days)</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Reason</p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the reason for this action…"
              rows={3}
            />
          </div>

          {banType === "permanent" && (
            <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-ds-11 text-destructive flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>This action is severe. The user will lose access permanently.</span>
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-border/40 -mx-5 sm:-mx-6 px-5 sm:px-6">
          <Button variant="ghost" onClick={handleClose} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            variant={banType === "warning" ? "default" : "destructive"}
            onClick={submit}
            disabled={banning || !reason.trim()}
            className="w-full sm:w-auto"
          >
            {banning
              ? "Processing…"
              : banType === "warning"
              ? "Issue Warning"
              : banType === "temporary"
              ? `Ban for ${duration} days`
              : "Permanently Ban"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
