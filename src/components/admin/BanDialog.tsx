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
  DialogHero,
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

// Structured reason picker — drives the "category" of the action and is
// stored on user_violations.violation_type / user_bans.reason so the
// audit trail is consistent. Anything that doesn't fit ⇒ "other" + a
// freeform note.
const REASON_OPTIONS: { id: string; label: string }[] = [
  { id: "spam", label: "Spam" },
  { id: "fraud", label: "Fraud" },
  { id: "harassment", label: "Harassment" },
  { id: "tos", label: "Terms of Service violation" },
  { id: "other", label: "Other" },
];

// Duration matches the spec: 7d / 30d / 90d / permanent. Permanent is
// modelled as banType=permanent below, the three day-based options use
// banType=temporary.
const DURATION_OPTIONS: { id: string; label: string; days: number | "permanent" }[] = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "permanent", label: "Permanent", days: "permanent" },
];

export function BanDialog({ profile, onClose, onSuccess }: BanDialogProps) {
  const [banType, setBanType] = useState<BanType>("warning");
  const [reasonCategory, setReasonCategory] = useState<string>("tos");
  const [reasonNote, setReasonNote] = useState("");
  const [duration, setDuration] = useState("7");
  const [banning, setBanning] = useState(false);

  // Composite reason text we persist — keeps the picker visible in audit /
  // user-violation rows so it isn't lost in a freeform string.
  const composeReason = () => {
    const cat = REASON_OPTIONS.find((r) => r.id === reasonCategory)?.label ?? "Other";
    const note = reasonNote.trim();
    return note ? `${cat} — ${note}` : cat;
  };

  const handleClose = () => {
    if (banning) return;
    setReasonNote("");
    setReasonCategory("tos");
    setBanType("warning");
    setDuration("7");
    onClose();
  };

  // Duration radio drives both banType and `duration` state at once so
  // the existing submit() branches keep working.
  const setDurationOption = (id: string) => {
    if (id === "permanent") {
      setBanType("permanent");
      return;
    }
    setBanType("temporary");
    setDuration(id.replace("d", ""));
  };
  const activeDurationId = banType === "permanent"
    ? "permanent"
    : `${duration}d`;

  const submit = async () => {
    if (!profile) return;
    const reason = composeReason();
    // Reason is composed (always has at least the category label), but
    // we still require an explicit category pick — if the admin chose
    // "other" we require the freeform note so audit isn't ambiguous.
    if (reasonCategory === "other" && !reasonNote.trim()) {
      toast.error("Add a freeform note for 'Other' reason");
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
        const { error: vErr } = await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_warning",
          description: reason,
          action_taken: "warning",
          reported_by: user.id,
        });
        if (vErr) throw vErr;
        const { error: pErr } = await supabase
          .from("profiles")
          .update({ ban_status: "final_warning" })
          .eq("user_id", profile.user_id);
        if (pErr) throw pErr;
        await createNotification({
          user_id: profile.user_id,
          title: "⚠️ Warning from Admin",
          message:
            reason ||
            "You have received a warning for violating platform rules. Another violation may result in a ban.",
          type: "warning",
          link: "/profile",
        });
        toast.success("Warning issued.");
        await logAdminAction("ban_user", "user", profile.user_id, {
          type: "warning",
          reason_category: reasonCategory,
          reason_note: reasonNote.trim(),
        });
      } else if (banType === "temporary") {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(duration));
        const { error: bErr } = await supabase.from("user_bans").insert({
          user_id: profile.user_id,
          ban_type: "temporary",
          reason,
          banned_by: user.id,
          expires_at: expiresAt.toISOString(),
        });
        if (bErr) throw bErr;
        const { error: vErr } = await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_action",
          description: reason,
          action_taken: "temp_ban",
          reported_by: user.id,
        });
        if (vErr) throw vErr;
        const { error: pErr } = await supabase
          .from("profiles")
          .update({ ban_status: "temp_banned" })
          .eq("user_id", profile.user_id);
        if (pErr) throw pErr;
        await createNotification({
          user_id: profile.user_id,
          title: "🚫 Temporary Ban",
          message: `Your account has been temporarily banned for ${duration} days. Reason: ${reason}`,
          type: "warning",
          link: "/profile",
        });
        toast.success(`User temporarily banned for ${duration} days.`);
        await logAdminAction("ban_user", "user", profile.user_id, {
          type: "temporary",
          duration_days: parseInt(duration),
          reason_category: reasonCategory,
          reason_note: reasonNote.trim(),
        });
      } else {
        const { error: bErr } = await supabase.from("user_bans").insert({
          user_id: profile.user_id,
          ban_type: "permanent",
          reason,
          banned_by: user.id,
        });
        if (bErr) throw bErr;
        const { error: vErr } = await supabase.from("user_violations").insert({
          user_id: profile.user_id,
          violation_type: "admin_action",
          description: reason,
          action_taken: "permanent_ban",
          reported_by: user.id,
        });
        if (vErr) throw vErr;
        const { error: pErr } = await supabase
          .from("profiles")
          .update({ ban_status: "permanently_banned" })
          .eq("user_id", profile.user_id);
        if (pErr) throw pErr;
        await createNotification({
          user_id: profile.user_id,
          title: "⛔ Account Permanently Banned",
          message: `Your account has been permanently banned. Reason: ${reason}`,
          type: "warning",
          link: "/profile",
        });
        toast.success("User permanently banned.");
        await logAdminAction("ban_user", "user", profile.user_id, {
          type: "permanent",
          reason_category: reasonCategory,
          reason_note: reasonNote.trim(),
        });
      }

      onSuccess?.();
      handleClose();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't apply that action — try again");
    } finally {
      setBanning(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-5 sm:p-6 gap-5">
        <DialogHero
          eyebrow={
            <>
              <ShieldAlert className="w-3.5 h-3.5" /> Take action
            </>
          }
          eyebrowClassName="inline-flex items-center gap-1.5"
          title={`Take Action: ${profile?.full_name || "User"}`}
        />
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
                  onClick={() => {
                    setBanType(opt.key);
                    // Reset duration when switching away from a ban to
                    // a non-ban — keeps activeDurationId in sync.
                    if (opt.key === "warning") setDuration("7");
                  }}
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

          {/* Reason picker — drops the freeform-only flow in favour of a
              structured category + optional note. Logged to
              admin_audit_log as reason_category + reason_note so future
              reports can filter by category. */}
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Reason</p>
            <Select value={reasonCategory} onValueChange={setReasonCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              aria-label="Reason note"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder={reasonCategory === "other"
                ? "Required — describe what happened."
                : "Optional note — context for the audit trail."}
              rows={3}
            />
          </div>

          {/* Duration radio — appears only when the action is a ban. The
              "Permanent" option flips banType internally so the existing
              permanent-ban branch in submit() handles it. */}
          {banType !== "warning" && (
            <div className="space-y-2">
              <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Duration</p>
              <div role="radiogroup" aria-label="Ban duration" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DURATION_OPTIONS.map((opt) => {
                  const active = activeDurationId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDurationOption(opt.id)}
                      className={`p-2 rounded-ds-md border text-center text-ds-11 font-medium transition-colors ${
                        active
                          ? opt.id === "permanent"
                            ? "border-destructive/60 bg-destructive/20 text-destructive"
                            : "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-card hover:bg-secondary/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            disabled={banning || (reasonCategory === "other" && !reasonNote.trim())}
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
