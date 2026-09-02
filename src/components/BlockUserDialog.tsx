import { useEffect, useState } from "react";
// Dialog, not AlertDialog. AlertDialog is the shared primitive for a PURE
// confirm; this dialog collects a free-text reason, so it is a form and
// belongs on the same Dialog + DialogHero shell every other safety popup uses
// (ReportDialog, MuteSheet). Owner, 2026-08-25: block and report "have
// different pop up dialog shells? Why??".
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { blockUser } from "@/lib/userBlocks";
// The SAME ladder module the edge function charges from and CancellationDialog
// quotes. Display-only here — the amount that actually moves is recomputed
// server-side — but it has to agree with what the poster is about to be
// charged, so it is read, never restated.
import {
  jobLocalMidnightMs,
  cancellationFeePercent,
} from "../../supabase/functions/_shared/cancellationFee";
import { formatPriceExact } from "@/lib/format";

interface BlockUserDialogProps {
  open: boolean;
  onClose: () => void;
  blockedUserId: string;
  blockedUserName: string;
  /** Called after a successful block so the parent can navigate / refresh. */
  onBlocked?: (cancelledJobIds: string[]) => void;
  /** Optional — surfaces the "Report and block" combo button so the
   *  user can flag the account for the trust team in the same gesture
   *  that protects them from it. Receives no args; the parent owns the
   *  Report dialog open state and routes it through this hook. */
  onReportAndBlock?: () => void;
}

export function BlockUserDialog({
  open,
  onClose,
  blockedUserId,
  blockedUserName,
  onBlocked,
  onReportAndBlock,
}: BlockUserDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  // Estimated total late-cancellation fee across the live shared jobs, and
  // whether the current user is the POSTER on any of them (only the poster
  // pays the fee and takes the reliability strike).
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [isPosterOnAny, setIsPosterOnAny] = useState(false);

  // Look up active jobs between the two users so we can warn the user
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("jobs")
        .select("id, budget, date_needed, customer_id, helper_id")
        .or(
          `and(customer_id.eq.${user.id},helper_id.eq.${blockedUserId}),and(customer_id.eq.${blockedUserId},helper_id.eq.${user.id})`,
        )
        .in("status", ["accepted", "in_progress", "revision_requested"]);
      if (error) {
        // A swallowed error here would set the count to 0 and hide the
        // "active jobs will be cancelled" warning — leave it unknown
        // (null) instead of implying it's safe to block.
        console.error("[BlockUserDialog] active-job lookup failed:", error);
        return;
      }
      if (cancelled) return;
      const rows = data ?? [];
      setActiveJobCount(rows.length);
      const mine = rows.filter((r) => r.customer_id === user.id);
      setIsPosterOnAny(mine.length > 0);
      setEstimatedFee(
        mine.reduce((sum, r) => {
          if (!r.date_needed || !(Number(r.budget) > 0) || !r.helper_id) return sum;
          const hours = (jobLocalMidnightMs(r.date_needed) - Date.now()) / (1000 * 60 * 60);
          const percent = cancellationFeePercent(true, hours);
          return sum + Math.round(Number(r.budget) * percent) / 100;
        }, 0),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, blockedUserId]);

  // Resolves `true` only when the block landed — "Block and Report" keys
  // off this so a failed block never proceeds into the report flow.
  const handleBlock = async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in.");
        return false;
      }
      const result = await blockUser(user.id, blockedUserId, reason.trim() || undefined);
      if (!result.ok) {
        toast.error(result.error || "Couldn't block this person — try again?");
        return false;
      }

      // The per-job notification is sent by block_user_and_settle, inside the
      // same transaction that cancels the job — so it says the real fee and
      // cannot be lost if this tab closes mid-gesture.

      onBlocked?.(result.cancelledJobIds);
      onClose();
      setReason("");
      return true;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent>
        <DialogHero
          title={<>Block {blockedUserName}?</>}
        />
        <div className="space-y-3 mt-2">
              <DialogBody>
                <ul className="space-y-1 list-disc pl-5">
                <li>You won&apos;t see their messages, applications, or profile.</li>
                <li>They won&apos;t be able to apply to your jobs or message you.</li>
                <li>They won&apos;t be notified that you blocked them.</li>
                {activeJobCount !== null && activeJobCount > 0 && (
                  <li className="not-italic font-sans font-medium" style={{ color: "hsl(var(--burnt-sienna))" }}>
                    {activeJobCount} active job{activeJobCount === 1 ? "" : "s"} between you will be cancelled.{" "}
                    {isPosterOnAny ? (
                      estimatedFee > 0 ? (
                        <>
                          This counts as a late cancellation: about{" "}
                          ${formatPriceExact(estimatedFee)} in cancellation fees will be
                          charged and paid to your Helpr, the rest of your escrow is
                          refunded, and a cancellation strike is recorded on your account.
                        </>
                      ) : (
                        <>
                          You&rsquo;re far enough ahead of the job date that no
                          cancellation fee applies — your escrow is refunded in full — but
                          a cancellation strike is still recorded on your account.
                        </>
                      )
                    ) : (
                      <>Any escrow held on {activeJobCount === 1 ? "it" : "them"} settles under the normal cancellation rules.</>
                    )}
                  </li>
                )}
                </ul>
              </DialogBody>
              <div className="space-y-1.5">
                <label
                  className="font-serif italic uppercase block text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                >
                  Reason — optional, admin-only
                </label>
                <Textarea
                  aria-label="Block reason (optional, admin-only)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14"
                />
              </div>
            </div>
        {/* Force normal (top-down) column order — shadcn's footer defaults to
            flex-col-reverse on mobile, which would float Cancel to the top.
            We want the action stack to read Just block → Block and report →
            Cancel, with Cancel anchored at the bottom. */}
        {/* THE SHARED FOOTER, with the canonical DOM order.
            `DialogFooter` is `flex-col-reverse` on phones and a right-aligned
            `flex-row` from `sm` up, so DOM order [dismiss … primary] renders
            as primary-on-top / dismiss-at-the-bottom on a phone and
            dismiss-left / primary-right on a desktop — the same reading order
            both ways. This footer had `!flex-col sm:!items-stretch
            sm:!space-x-0`, which forced a full-width stack at EVERY width and,
            being `flex-col` rather than `-reverse`, left the primary in the
            MIDDLE of the stack.

            All three buttons are shared variants now. Blocking is punitive and
            the blocker cannot undo it from this screen, so it takes the same
            `destructive` red as "Confirm No-Show" and "Delete User"; when a
            report path is offered, "Block and Report" is the primary and
            "Just Block" steps back to `outline`. The three hand-written sienna
            style objects (a 16%-tint secondary and two solid fills) were a
            fourth and fifth destructive treatment on top of the two already in
            the app. */}
        <DialogFooter>
          <DialogClose asChild>
            <DialogSecondaryAction disabled={submitting}>Cancel</DialogSecondaryAction>
          </DialogClose>
          {/* THE ONLY THREE-ACTION FOOTER IN THE APP, and the one documented
              exception in dialogShell.test.ts. It is not decoration: "Just
              Block" and "Block and Report" are two different writes, and the
              brief for this pass was explicit that no dialog loses an action
              to fit the pattern.
              The demotion the old `outline` expressed is kept, said in the
              canonical vocabulary: when a report path is offered, "Block and
              Report" is the one red commit and "Just Block" steps back to the
              app's demoted treatment (ghost) rather than to a bordered
              `outline` button no other popup uses. With no report path there
              is nothing to demote against, so blocking IS the commit and takes
              the red. Two reds side by side would be the hierarchy defect this
              avoids. */}
          {onReportAndBlock ? (
            <DialogSecondaryAction
              onClick={(e) => {
                e.preventDefault();
                handleBlock();
              }}
              disabled={submitting}
            >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Blocking…
              </>
            ) : (
              "Just Block"
            )}
            </DialogSecondaryAction>
          ) : (
            <DialogDestructiveAction
              onClick={(e) => {
                e.preventDefault();
                handleBlock();
              }}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Blocking…
                </>
              ) : (
                "Just Block"
              )}
            </DialogDestructiveAction>
          )}
          {onReportAndBlock && (
            <DialogDestructiveAction
              onClick={async (e) => {
                e.preventDefault();
                const blocked = await handleBlock();
                if (blocked) onReportAndBlock();
              }}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Working…
                </>
              ) : (
                "Block and Report"
              )}
            </DialogDestructiveAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
