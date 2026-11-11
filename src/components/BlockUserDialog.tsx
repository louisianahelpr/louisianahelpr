import { useEffect, useId, useState } from "react";
// A plain Dialog, NOT a confirm — no `role="alertdialog"`. A confirm's
// buttons auto-close it (see MaybeClose in dialog.tsx); this one collects a
// free-text reason first, so its Cancel is wrapped in <DialogClose> and its
// commit closes only after the write. Same Dialog + DialogHero shell as every
// other safety popup
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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { blockUser } from "@/lib/userBlocks";
// The SAME ladder module the edge function charges from and CancellationDialog
// quotes. Display-only here — the amount that actually moves is recomputed
// server-side — but it has to agree with what the poster is about to be
// charged, so it is read, never restated.
import { computeCancellationFee } from "../../supabase/functions/_shared/cancellationFee";
import { formatPriceExact } from "@/lib/format";

/** Who the sheet is about. `muteInstead` is set where a thread exists to mute (the chat), see F428. */
export type BlockTarget = { id: string; name: string; muteInstead?: () => void };

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
  /** F428: "Mute instead", the first button in the sheet. Closes the sheet, then opens the mute picker. */
  onMuteInstead?: () => void;
}

export function BlockUserDialog({
  open,
  onClose,
  blockedUserId,
  blockedUserName,
  onBlocked,
  onReportAndBlock,
  onMuteInstead,
}: BlockUserDialogProps) {
  const [reason, setReason] = useState("");
  // Q2682 (audit 1102e row 35): reporting is a choice in the body, not a third footer button. "Just block" sat beside
  // Cancel in the same grey and read as a second Cancel; now the footer is the app's one shape, Cancel | the red commit.
  const [alsoReport, setAlsoReport] = useState(false);
  const reportId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  // Estimated total late-cancellation fee across the live shared jobs, and
  // whether the current user is the POSTER on any of them (only the poster
  // pays the fee and takes the reliability strike).
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [isPosterOnAny, setIsPosterOnAny] = useState(false);
  // Q2676: hired on any of them (the blocker is the Helpr): block_user_and_settle treats that like the Helpr cancelling.
  const [isHelprOnAny, setIsHelprOnAny] = useState(false);
  // Q2675 (audit 1102e row 8): the sheet counted "2 active jobs" and never named them. F260i: `late` marks a job whose
  // block costs the poster an amount (it starts within 24 hours), so the sheet can say WHICH job, not "it".
  const [jobs, setJobs] = useState<{ title: string; late: boolean }[]>([]);
  const [lateCount, setLateCount] = useState(0);
  // F260i (whole-app audit 2026-11-10): ten titles were a wall; three show, the rest behind "Show all".
  const [showAllJobs, setShowAllJobs] = useState(false);

  // Look up active jobs between the two users so we can warn the user
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setShowAllJobs(false);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, budget, date_needed, start_time, customer_id, helper_id, helper_confirmed_at")
        .or(
          `and(customer_id.eq.${user.id},helper_id.eq.${blockedUserId}),and(customer_id.eq.${blockedUserId},helper_id.eq.${user.id})`,
        )
        .in("status", ["accepted", "in_progress", "revision_requested"])
        // Same set block_user_and_settle cancels: finished work is not
        // cancelled by a block, so it is neither counted nor charged a fee.
        .is("helper_completed_at", null);
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
      setIsPosterOnAny(rows.some((r) => r.customer_id === user.id));
      setIsHelprOnAny(rows.some((r) => r.helper_id === user.id));
      // Q236(c) (owner, 2026-09-27): NO fee on an offer the Helpr never
      // accepted. block_user_and_settle prices each job on commitment
      // (helper_confirmed_at) and its start time; this quote used to price
      // any assigned Helpr at midnight of the day, so it promised a fee the
      // server never charges. computeCancellationFee is the server's own rule.
      // Only the poster pays, so a job where the blocker is the Helpr costs 0.
      const priced = rows.map((r) => ({
        title: (r.title ?? "").trim(),
        fee:
          r.customer_id !== user.id
            ? 0
            : computeCancellationFee({
                budget: r.budget == null ? null : Number(r.budget),
                date_needed: r.date_needed,
                start_time: r.start_time ?? null,
                cancelled_at: null,
                helper_id: r.helper_id,
                helper_confirmed_at: r.helper_confirmed_at ?? null,
              }),
      }));
      setEstimatedFee(priced.reduce((sum, j) => sum + j.fee, 0));
      setLateCount(priced.filter((j) => j.fee > 0).length);
      // Late jobs first, so the three that show are the ones the amount is for.
      setJobs(
        priced
          .filter((j) => j.title)
          .map((j) => ({ title: j.title, late: j.fee > 0 }))
          .sort((a, b) => Number(b.late) - Number(a.late)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, blockedUserId]);

  // Resolves `true` only when the block landed — "Block and report" keys
  // off this so a failed block never proceeds into the report flow.
  const handleBlock = async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Sign in to continue.");
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
      setAlsoReport(false);
      return true;
    } finally {
      setSubmitting(false);
    }
  };

  const hasJobs = activeJobCount !== null && activeJobCount > 0;
  const lateTitle = jobs.find((j) => j.late)?.title;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent>
        <DialogHero
          title={<>Block {blockedUserName}?</>}
        />
        <div className="space-y-3 mt-2">
              <DialogBody>
                {hasJobs && (
                  // F260i (whole-app audit 2026-11-10): the summary comes FIRST, in one short line: how many jobs, the
                  // amount, the strike. Before, the strike sat at the bottom of a 10-title wall. Q2675 + Q2676 (lead
                  // 11-02, migration 20261102131745): a poster's block is a strike only inside 24 hours of the start;
                  // a hired Helpr's block costs the poster nothing and is the Helpr's strike only inside 24 hours.
                  // "The Helpr's time", never "your Helpr's" (F428). Plain words; only the money is rust (audit #51).
                  <p className="mb-2 not-italic font-sans font-medium text-foreground">
                    Blocking {blockedUserName} also cancels {activeJobCount} job{activeJobCount === 1 ? "" : "s"}.
                    {isPosterOnAny && (estimatedFee > 0 ? (
                      <>
                        {" "}You will pay about{" "}
                        <span className="tabular-nums" style={{ color: "hsl(var(--sienna-ink))" }}>${formatPriceExact(estimatedFee)}</span> for the Helpr&rsquo;s time and it counts as a strike against you.
                      </>
                    ) : (
                      <> Nothing is kept for the Helpr&rsquo;s time and it isn&rsquo;t a strike.</>
                    ))}
                    {isHelprOnAny && (
                      <> A job you were hired for that starts within 24 hours counts as a strike, the same as cancelling.</>
                    )}
                  </p>
                )}
                <ul className="space-y-1 list-disc pl-5">
                <li>You won&apos;t see their messages, applications, or profile.</li>
                {/* Q2676 (audit 1102e row 9): both seats, never only the poster's ("apply to your jobs"). */}
                <li>They can&apos;t apply to your jobs, offer you a job, or message you.</li>
                <li>They won&apos;t be notified that you blocked them.</li>
                {hasJobs && jobs.length > 0 && (
                  // F428: the titles are a nested list, never a run-on. F260i: three show, late ones first and marked.
                  <li>
                    Jobs cancelled:
                    <ul className="list-[circle] pl-5" aria-label="Jobs that will be cancelled">
                      {(showAllJobs ? jobs : jobs.slice(0, 3)).map((j, i) => (
                        <li key={i}>&ldquo;{j.title}&rdquo;{j.late && <> (starts within 24 hours)</>}</li>
                      ))}
                    </ul>
                    {!showAllJobs && jobs.length > 3 && (
                      <Button type="button" variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => setShowAllJobs(true)}>
                        Show all {jobs.length} jobs
                      </Button>
                    )}
                  </li>
                )}
                {hasJobs && isPosterOnAny && lateCount > 0 && (
                  // F260i: say WHICH job the amount is for; "(it starts within 24 hours)" never named one.
                  <li>
                    {lateCount === 1 && lateTitle ? (
                      <>That covers &ldquo;{lateTitle}&rdquo;, which starts within 24 hours.</>
                    ) : (
                      <>That covers {lateCount} job{lateCount === 1 ? " that starts" : "s that start"} within 24 hours.</>
                    )}{" "}You get most of the rest back.
                  </li>
                )}
                </ul>
              </DialogBody>
              {/* F428: the quiet way out comes first. A person who only wants silence should never have to read past
                  the red Block to find it. Shown only where a thread exists to mute (the chat; not a profile). */}
              {onMuteInstead && (
                <Button type="button" variant="outline" size="sm" className="w-full" disabled={submitting}
                  onClick={() => { onClose(); onMuteInstead(); }}>
                  Mute instead
                </Button>
              )}
              <div className="space-y-1.5">
                <label className="text-ds-13 font-sans font-medium text-muted-foreground block">
                  Reason (optional, only our team sees it)
                </label>
                <Textarea
                  aria-label="Block reason (optional, admin-only)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14"
                />
              </div>
              {onReportAndBlock && (
                <label htmlFor={reportId} className="flex min-h-11 items-start gap-3 cursor-pointer">
                  <Checkbox
                    id={reportId}
                    checked={alsoReport}
                    onCheckedChange={(v) => setAlsoReport(v === true)}
                    disabled={submitting}
                    className="mt-0.5"
                  />
                  <span className="text-ds-14 font-sans text-foreground">
                    Also report {blockedUserName} to our team
                  </span>
                </label>
              )}
            </div>
        {/* THE SHARED FOOTER, with the canonical DOM order.
            `DialogFooter` is `flex-col-reverse` on phones and a right-aligned
            `flex-row` from `sm` up, so DOM order [dismiss … primary] renders
            as primary-on-top / dismiss-at-the-bottom on a phone and
            dismiss-left / primary-right on a desktop — the same reading order
            both ways. This footer had `!flex-col sm:!items-stretch
            sm:!space-x-0`, which forced a full-width stack at EVERY width and,
            being `flex-col` rather than `-reverse`, left the primary in the
            MIDDLE of the stack.

            Both buttons are shared variants (Q2682 dropped the third, "Just
            block", for the "Also report" box above). */}
        <DialogFooter>
          <DialogClose asChild>
            <DialogSecondaryAction disabled={submitting}>Cancel</DialogSecondaryAction>
          </DialogClose>
          {/* ONE COMMIT (Q2682). Blocking is punitive and the blocker cannot undo it from this screen, so it takes the
              same `destructive` red as "Confirm No-Show". With "Also report" ticked the same button blocks, then opens
              the report (a failed block never proceeds into the report flow). */}
          <DialogDestructiveAction
            onClick={async (e) => {
              e.preventDefault();
              const report = alsoReport && !!onReportAndBlock;
              const blocked = await handleBlock();
              if (blocked && report) onReportAndBlock();
            }}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Blocking…
              </>
            ) : alsoReport && onReportAndBlock ? (
              "Block and report"
            ) : (
              "Block"
            )}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
