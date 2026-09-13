// RestrictApplicationsDialog — the admin control for `helper_shadowbans`.
//
// WHY THIS EXISTS
// ---------------
// The table, its RLS ("Admins can manage shadowbans", ALL, admin-only — so a
// restricted helper cannot even read their own row), `is_helper_shadowbanned()`
// and the `block_shadowbanned_applications()` trigger on `applications` have
// all been live in prod with ZERO rows and NO way for an admin to create one.
// The enforcement half shipped without the operating half, which is the same
// shape as a guard that cannot run: it reads as a capability the platform has,
// and it has never once been usable.
//
// WHY IT IS NOT CALLED "SHADOWBAN"
// --------------------------------
// Because it is not one, and naming it that would make this console assert
// something false about its own behaviour. A shadowban is defined by the target
// not knowing: the action appears to succeed and the result is quietly hidden.
// `block_shadowbanned_applications()` does the opposite — it RAISES
// 'Your account is temporarily restricted. Please try again later.', so the
// helper is told, immediately and in as many words, every time they apply. That
// is a visible, time-boxed restriction. The label here describes what the
// button does; the gap between the column name and the behaviour is filed
// separately rather than papered over with a euphemism in the UI.
//
// It is deliberately SEPARATE from BanDialog: that dialog owns the consequence
// ladder (warning → temp ban → permanent ban) and writes `profiles.ban_status`,
// which locks the whole account. This is orthogonal and narrower — the helper
// keeps their account, their jobs and their messages, and only loses the
// ability to take on new work for a fixed window.

import { useRef, useState } from "react";
import { confirmConsequential } from "@/lib/toastPolicy";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
  DialogBody,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { logAdminAction } from "@/lib/adminAudit";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface RestrictApplicationsDialogProps {
  /** Target profile. When null, the dialog is closed. */
  profile: Profile | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// `helper_shadowbans.expires_at` is NOT NULL, so every restriction is
// time-boxed by construction — there is no permanent variant, and that is the
// point of this control versus a ban. `is_helper_shadowbanned()` compares
// `expires_at > now()`, so a lapsed row stops applying with no sweep needed.
const DURATION_OPTIONS: { id: string; label: string; days: number }[] = [
  { id: "3", label: "3 days", days: 3 },
  { id: "7", label: "7 days", days: 7 },
  { id: "14", label: "14 days", days: 14 },
  { id: "30", label: "30 days", days: 30 },
];

export function RestrictApplicationsDialog({
  profile,
  onClose,
  onSuccess,
}: RestrictApplicationsDialogProps) {
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // `saving` is state: two clicks in one frame both read false. The ref sees the first.
  const inFlight = useRef(false);

  const handleClose = () => {
    if (saving) return;
    setReason("");
    setDays("7");
    onClose();
  };

  const submit = async () => {
    if (!profile) return;
    // `reason` is NOT NULL on the table and is the only record of WHY this was
    // applied — the helper never sees it, so an empty one leaves the next
    // operator with a restriction and no explanation.
    if (!reason.trim()) {
      toast.error("Add a reason — it is the only record of why this was applied.");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(days, 10));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        inFlight.current = false;
        setSaving(false);
        return;
      }
      // .select("id") + unwrapMutation: an INSERT that RLS rejects returns
      // `{ data: [], error: null }`, and without this the dialog would close on
      // a restriction that was never created — a no-op dressed as an
      // enforcement action, on a trust surface.
      unwrapMutation(
        await supabase
          .from("helper_shadowbans")
          .insert({
            helper_id: profile.user_id,
            reason: reason.trim(),
            expires_at: expiresAt.toISOString(),
            // `created_by` defaults to 'system'; the whole reason this control
            // exists is that a human did it, so say which human.
            created_by: user.id,
          })
          .select("id"),
        {
          action: "apply this restriction",
          rejectedMessage:
            "The restriction wasn't applied — this account is unchanged. Check your admin permissions and try again.",
          context: { targetUserId: profile.user_id, days },
        },
      );

      // No `createNotification` on purpose. Every other action in this console
      // tells the user what happened, and that asymmetry is deliberate here:
      // the trigger already tells them at the moment it bites, and a
      // notification would announce a restriction they have not yet hit.
      await logAdminAction("restrict_applications", "user", profile.user_id, {
        duration_days: parseInt(days, 10),
        expires_at: expiresAt.toISOString(),
        reason: reason.trim(),
      });

      confirmConsequential(`Applications restricted for ${days} days.`);
      onSuccess?.();
      handleClose();
    } catch (err) {
      toast.error(mutationErrorMessage(err, "Couldn't apply that restriction — try again"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        {/* Title only — DialogHero takes no eyebrow or subtitle (dialog.tsx:614,
            and passing them used to be silently discarded). The scope sentence
            that would have been a subtitle leads the body instead. */}
        <DialogHero title={`Restrict: ${profile?.full_name || "User"}`} />
        <div className="space-y-5">
          <p className="text-ds-12 text-muted-foreground">
            Blocks new job applications for a fixed window. The account, its live
            jobs and its messages are untouched.
          </p>
          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Duration</p>
            <div role="radiogroup" aria-label="Restriction duration" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const active = days === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDays(opt.id)}
                    className={`p-2 rounded-ds-md border text-center text-ds-11 font-medium transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-secondary/30"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-ds-11 font-medium text-muted-foreground uppercase tracking-wide">Reason</p>
            <Textarea
              aria-label="Restriction reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required — internal only, the Helpr never sees this."
              rows={3}
            />
          </div>

          {/* Says plainly what the helper experiences, because an operator
              choosing this needs to know it is not silent. The string is the
              trigger's own message. */}
          <div className="rounded-ds-sm bg-accent/10 border border-accent/20 p-3">
            <DialogBody>
              This is not silent. Each time they apply they are told
              “Your account is temporarily restricted. Please try again later.”
              It lapses on its own — no one has to lift it.
            </DialogBody>
          </div>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose}>Cancel</DialogSecondaryAction>
          <DialogDestructiveAction onClick={submit} disabled={saving || !reason.trim()}>
            {saving ? "Applying…" : `Restrict for ${days} days`}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
