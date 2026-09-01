// BanDialog — third extraction in the AdminUsers cleanup. The 3-tier
// "take action" dialog (warning / temporary / permanent) is one of the
// largest self-contained chunks in AdminUsers. Owns its own type +
// reason + duration + saving state. Parent passes the target profile
// and an onSuccess callback (refetch + close any parent profile detail).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Clock, Ban } from "lucide-react";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { logAdminAction } from "@/lib/adminAudit";
import type { Database } from "@/integrations/supabase/types";
import { requireBiometric } from "@/lib/biometricGate";

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
      toast.error("Add a freeform note for 'Other' reason.");
      return;
    }
    // Face ID / Touch ID gate: a permanent ban ends someone's ability to earn
    // on this platform and there is no self-serve undo. An admin's merely
    // unlocked phone shouldn't be enough. Runs AFTER validation so a rejected
    // form never raises an OS prompt for nothing. No-op on web and on devices
    // without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric(
      banType === "permanent" ? "Confirm this permanent ban" : "Confirm this account action",
    );
    if (!ok) return;
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
        // .select("user_id"): the ban row above is only bookkeeping — this is
        // the write the app actually reads to lock the account. A zero-row
        // update (RLS on profiles, stale user_id) returns error === null, and
        // the dialog used to close on a ban that never took effect.
        unwrapMutation(
          await supabase
            .from("profiles")
            .update({ ban_status: "final_warning" })
            .eq("user_id", profile.user_id)
            .select("user_id"),
          {
            action: "record this warning",
            rejectedMessage: "The warning wasn't applied to this account — nothing was changed. Check your admin permissions and try again.",
            context: { targetUserId: profile.user_id, banType },
          },
        );
        await createNotification({
          user_id: profile.user_id,
          title: "⚠️ Warning from Admin",
          message:
            reason ||
            "You have received a warning for violating platform rules. Another violation may result in a ban.",
          type: "warning",
          // The strike this notification is about is listed on Warnings &
          // Strikes; bare "/profile" opens the landing tab, which never
          // mentions it.
          link: "/profile?tab=warnings",
        });
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
        // .select("user_id"): the ban row above is only bookkeeping — this is
        // the write the app actually reads to lock the account. A zero-row
        // update (RLS on profiles, stale user_id) returns error === null, and
        // the dialog used to close on a ban that never took effect.
        // `auto_suspended_until` is NOT optional bookkeeping — it is the only
        // column anything reads to END this suspension, and the only one that
        // tells the user when it ends:
        //   • sweep_expired_auto_bans (the cron that lifts a temp ban) selects
        //     `ban_status='temp_banned' AND auto_suspended_until < NOW()`. It
        //     never looks at user_bans.expires_at, and nothing else does either.
        //   • StrikeBanner.tsx renders the "suspended until …" countdown from
        //     this column and shows nothing without it.
        // So writing only `user_bans.expires_at` (as this did) meant an admin's
        // "Ban for 7 days" — with the dialog and the user's own notification
        // both promising a duration — never auto-lifted and never displayed an
        // end date. The account stayed locked until a human happened to click
        // Lift Ban. Writing the same instant here makes the promise true.
        unwrapMutation(
          await supabase
            .from("profiles")
            .update({ ban_status: "temp_banned", auto_suspended_until: expiresAt.toISOString() })
            .eq("user_id", profile.user_id)
            .select("user_id"),
          {
            action: "apply this temporary ban",
            rejectedMessage: "The temporary ban wasn't applied — this account is unchanged. Check your admin permissions and try again.",
            context: { targetUserId: profile.user_id, banType },
          },
        );
        await createNotification({
          user_id: profile.user_id,
          title: "🚫 Temporary Ban",
          message: `Your account has been temporarily banned for ${duration} days. Reason: ${reason}`,
          type: "warning",
          // The strike this notification is about is listed on Warnings &
          // Strikes; bare "/profile" opens the landing tab, which never
          // mentions it.
          link: "/profile?tab=warnings",
        });
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
        // .select("user_id"): the ban row above is only bookkeeping — this is
        // the write the app actually reads to lock the account. A zero-row
        // update (RLS on profiles, stale user_id) returns error === null, and
        // the dialog used to close on a ban that never took effect.
        unwrapMutation(
          await supabase
            .from("profiles")
            .update({ ban_status: "permanently_banned" })
            .eq("user_id", profile.user_id)
            .select("user_id"),
          {
            action: "apply this permanent ban",
            rejectedMessage: "The permanent ban wasn't applied — this account is unchanged. Check your admin permissions and try again.",
            context: { targetUserId: profile.user_id, banType },
          },
        );
        await createNotification({
          user_id: profile.user_id,
          title: "⛔ Account Permanently Banned",
          message: `Your account has been permanently banned. Reason: ${reason}`,
          type: "warning",
          // A permanent ban has its own screen, and it is the only one the
          // banned user can still reach — matching the '/account-banned' the
          // server-side ban path (auto_restrict_repeat_violators) writes.
          link: "/account-banned",
        });
        await logAdminAction("ban_user", "user", profile.user_id, {
          type: "permanent",
          reason_category: reasonCategory,
          reason_note: reasonNote.trim(),
        });
      }

      onSuccess?.();
      handleClose();
    } catch (err) {
      toast.error(mutationErrorMessage(err, (err as Error).message || "Couldn't apply that action — try again"));
    } finally {
      setBanning(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero
          title={`Take Action: ${profile?.full_name || "User"}`}
        />
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Action type</p>
            <div role="radiogroup" aria-label="Action type" className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "warning", label: "Warning", icon: <AlertTriangle className="w-4 h-4" />, color: "border-accent/40 bg-accent/10" },
                  { key: "temporary", label: "Temp Ban", icon: <Clock className="w-4 h-4" />, color: "border-destructive/40 bg-destructive/10" },
                  { key: "permanent", label: "Perm Ban", icon: <Ban className="w-4 h-4" />, color: "border-destructive/60 bg-destructive/20" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  role="radio"
                  aria-checked={banType === opt.key}
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
              <SelectTrigger aria-label="Reason">
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
        {/* Plain DialogFooter. This carried a full-bleed rule that no other
              popup in the app has, and the bleed arithmetic was wrong: the
              negative margins were written for a `p-5 sm:p-6` container, but
              DialogContent is `p-4 sm:p-5`, so the divider overshot the card
              edge by 4px at every breakpoint and drew across the rounded
              corner radius. */}
          <DialogFooter>
          <DialogSecondaryAction onClick={handleClose}>
            Cancel
          </DialogSecondaryAction>
          {/* The tone is a CHOICE OF COMPONENT, not a `variant` expression.
              A warning is reversible — it is the bottom rung of the ladder —
              so it commits with the glossy primary; a temporary or permanent
              ban takes something away, so it takes the one destructive red.
              Written as two elements rather than `variant={cond ? … : …}`
              because a runtime variant is exactly the seam a `className`
              override slips back in through. */}
          {banType === "warning" ? (
            <DialogPrimaryAction
              onClick={submit}
              disabled={banning || (reasonCategory === "other" && !reasonNote.trim())}
            >
              {banning ? "Processing…" : "Issue Warning"}
            </DialogPrimaryAction>
          ) : (
            <DialogDestructiveAction
              onClick={submit}
              disabled={banning || (reasonCategory === "other" && !reasonNote.trim())}
            >
              {banning
                ? "Processing…"
                : banType === "temporary"
                ? `Ban for ${duration} days`
                : "Permanently Ban"}
            </DialogDestructiveAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
