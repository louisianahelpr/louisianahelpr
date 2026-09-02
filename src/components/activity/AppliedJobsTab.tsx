import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticLight, hapticSuccess } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Briefcase, Check } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { type Application, type AppliedApp, type Job } from "./activityConstants";
import { AppliedJobCard } from "./AppliedJobCard";
import { ActivitySectionedView } from "@/pages/activity/ActivitySectionedView";
import { bucketAppliedApp } from "@/pages/activity/activityFilters";
import type { TrackingData } from "@/components/JobTracking";
import { logWithdrawReason, type WithdrawReason } from "@/lib/applicationWithdrawAnalytics";

interface AppliedJobsTabProps {
  apps: AppliedApp[];
  /** Application id from the ?highlight= deep-link. The matching card
   *  scrolls into view and shows a brief pulse ring on mount. Consumed
   *  once — the parent strips the param from the URL after mount. */
  highlightAppId?: string | null;
  expandedJobIds: Set<string>;
  toggleExpandedJobId: (id: string) => void;
  helperReviewedJobIds: Set<string>;
  /** Batched per-job tracking rows, pre-fetched by useActivityData and
      threaded down to <JobTracking> so each active card doesn't re-fetch
      on mount (N+1 across confirmed/in-progress cards). */
  latestTracking: Record<string, TrackingData | null>;
  userId: string;
  onHelperResponse: (app: Application, accept: boolean) => void;
  respondingHelperAppId: string | null;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onResolveRevision: (jobId: string) => void;
  onHelperReview: (jobId: string, posterId: string, posterName: string) => void;
  /** Open the dispute dialog for this job — helper-initiated dispute (issue #113). */
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  onRefresh: () => void;
  /** When true, render items grouped into collapsible Active /
   *  Completed / Closed sections instead of a flat list.
   *  Driven by the page-level "All" status filter. The page's outer
   *  header (ActivityHeader) is the sole source of truth for filter +
   *  search in both modes. */
  groupByStatus?: boolean;
}

export const AppliedJobsTab = ({
  apps, highlightAppId, expandedJobIds, toggleExpandedJobId,
  helperReviewedJobIds, latestTracking, userId, onHelperResponse,
  respondingHelperAppId,
  onComplete, completingJobId,
  onResolveRevision, onHelperReview, onDispute, onViewDispute, onRefresh,
  groupByStatus = false,
}: AppliedJobsTabProps) => {
  const navigate = useNavigate();
  const [disputeResponse, setDisputeResponse] = useState("");
  const [respondingJobId, setRespondingJobId] = useState<string | null>(null);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [withdrawingAppId, setWithdrawingAppId] = useState<string | null>(null);
  // Slide-up confirmation sheet for Withdraw — friction where it matters.
  const [withdrawTarget, setWithdrawTarget] = useState<{ appId: string; jobTitle: string; jobId?: string | null } | null>(null);
  // Coded reason for the withdraw — fed into analytics so product can
  // see when "schedule_conflict" spikes (calendar UX gap), or when
  // "another_job" trends up (a healthy signal of helpers succeeding
  // on other posts). Required before confirming; defaults to null
  // each time the sheet opens.
  const [withdrawReason, setWithdrawReason] = useState<WithdrawReason | null>(null);
  // Optional free-text — only required when reason === "other".
  const [withdrawDetail, setWithdrawDetail] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState<string | null>(null);
  const [editingMessageAppId, setEditingMessageAppId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  // The bid-price editor lived here — a helper could revise their proposed
  // price while the poster hadn't yet viewed or countered it. It went with the
  // accept_bids mode (PRICING_MODE_REMOVED in BudgetSection); nothing proposes
  // a price any more, so there is nothing to edit. The server-side
  // enforce_bid_price_lock trigger it doubled up on is now unreachable too.
  const handleSaveMessage = useCallback(async (appId: string) => {
    setSavingMessage(true);
    // `.select("id")` for the same reason as the attachment writes below: a
    // bare `.update().eq(...)` resolves `{data: null, error: null}` whether it
    // changed one row or NONE, so once the application leaves `status =
    // 'pending'` (the RLS UPDATE predicate) this reported "Message updated"
    // over a write that never landed.
    const { data: saved, error } = await supabase
      .from("applications")
      .update({ message: editMessageText.trim() || null })
      .eq("id", appId)
      .select("id");
    setSavingMessage(false);
    if (error || !saved || saved.length === 0) {
      hapticError();
      // Editor stays OPEN with the typed text intact — closing here (as this
      // used to) discarded the note the toast is asking the helper to retry.
      toast.error("Couldn't save your note — try again?");
      return;
    }
    hapticSuccess();
    onRefresh();
    setEditingMessageAppId(null);
  }, [editMessageText, onRefresh]);

  const confirmWithdraw = useCallback(async () => {
    if (!withdrawTarget) return;
    if (!withdrawReason) { hapticError(); toast.error("Pick a reason to continue."); return; }
    if (withdrawReason === "other" && withdrawDetail.trim().length < 3) {
      hapticError();
      toast.error("Add a bit more detail.");
      return;
    }
    const { appId, jobId } = withdrawTarget;
    setWithdrawingAppId(appId);
    // Signal the destructive intent with an error haptic at the moment
    // of confirmed withdrawal — matches the task spec and gives tactile
    // confirmation that the irreversible action is being taken.
    hapticError();
    // `.select("id")` for the same reason as the updates above: a DELETE that
    // matches zero rows is `{data: null, error: null}` — indistinguishable from
    // one that removed the application. RLS only permits deleting your own
    // PENDING application, so a helper whose application was accepted while
    // this sheet was open would have been told "Withdrawn from …" over a row
    // that is still there, and the card would reappear on the next refresh.
    const { data: removed, error } = await supabase
      .from("applications")
      .delete()
      .eq("id", appId)
      .eq("helper_id", userId)
      .select("id");
    setWithdrawingAppId(null);
    if (error || !removed || removed.length === 0) {
      // Leave the sheet open with the chosen reason and typed detail intact.
      // The cleanup below used to run unconditionally, so a failed withdraw
      // closed the sheet AND discarded everything the helper had entered —
      // "give it another try?" meant starting over.
      toast.error("Couldn't withdraw that one — give it another try?");
      return;
    }
    // Best-effort log — fire-and-forget, never blocks the toast.
    logWithdrawReason(appId, { reason: withdrawReason, detail: withdrawDetail }, jobId);
    onRefresh();
    setWithdrawTarget(null);
    setWithdrawReason(null);
    setWithdrawDetail("");
  }, [withdrawTarget, userId, withdrawReason, withdrawDetail]);

  const handleAddAttachment = useCallback(async (appId: string, jobId: string, currentUrls: string[], file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("That file's too large — keep it under 5 MB."); return; }
    setUploadingAttachment(appId);
    const ext = file.name.split('.').pop();
    const path = `${userId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("application-attachments").upload(path, file);
    if (uploadErr) { hapticError(); toast.error("Couldn't upload that file — try again?"); setUploadingAttachment(null); return; }
    const newUrls = [...currentUrls, path];
    // `.select()` for the same reason it is on every other write in this file:
    // a bare `.update().eq(...)` resolves `{data: null, error: null}` whether
    // it changed one row or none, so an RLS-filtered write looks like success.
    const { data: saved, error } = await supabase
      .from("applications")
      .update({ attachment_urls: newUrls })
      .eq("id", appId)
      .select("id");
    setUploadingAttachment(null);
    if (error || !saved || saved.length === 0) {
      hapticError();
      toast.error("Couldn't save that attachment — try again?");
      return;
    }
    // Re-read. Without this the write landed but the card kept rendering the
    // `attachment_urls` it was given on mount — so an application that now had
    // a file still read "No attachments yet" until something else happened to
    // refetch. That is the reported "I added attachment but it still said no
    // attachment".
    onRefresh();
  }, [userId, onRefresh]);

  const handleRemoveAttachment = useCallback(async (appId: string, currentUrls: string[], urlToRemove: string) => {
    const newUrls = currentUrls.filter(u => u !== urlToRemove);
    const { data: saved, error } = await supabase
      .from("applications")
      .update({ attachment_urls: newUrls })
      .eq("id", appId)
      .select("id");
    if (error || !saved || saved.length === 0) {
      hapticError();
      toast.error("Couldn't remove that — try again?");
      return;
    }
    // Undo, because removing was a single tap on the highest-chroma element in
    // the row with no confirm — next to a WITHDRAW that demands a whole sheet
    // and a coded reason. The file itself is never deleted from storage (only
    // its path leaves `attachment_urls`), so restoring is putting the array
    // back, and the toast is a better fit than a confirm dialog for something
    // this cheap to reverse.
    toast.success("Attachment removed", {
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            const { data: restored, error: undoErr } = await supabase
              .from("applications")
              .update({ attachment_urls: currentUrls })
              .eq("id", appId)
              .select("id");
            if (undoErr || !restored || restored.length === 0) {
              hapticError();
              toast.error("Couldn't put that back — re-attach it instead.");
              return;
            }
            onRefresh();
          })();
        },
      },
    });
    // Same as the add path — the list has to be re-read or the removed file
    // stays on screen.
    onRefresh();
  }, [onRefresh]);

  // One source of truth for the per-row render so both the flat
  // list view and the grouped Sectioned view paint identical
  // cards.
  const renderAppliedCard = (app: AppliedApp) => (
    <AppliedJobCard
      app={app}
      highlight={!!highlightAppId && highlightAppId === app.id}
      expandedJobIds={expandedJobIds}
      toggleExpandedJobId={toggleExpandedJobId}
      helperReviewedJobIds={helperReviewedJobIds}
      // `latestTracking[app.job_id]` may legitimately be `null`
      // ("we looked, no row exists") — the card forwards that into
      // <JobTracking> so it skips its own initial fetch. If the
      // job_id key is absent (not pre-fetched), JobTracking falls
      // back to its own query.
      initialTracking={latestTracking[app.job_id]}
      userId={userId}
      onHelperResponse={onHelperResponse}
      respondingHelperAppId={respondingHelperAppId}
      onComplete={onComplete}
      completingJobId={completingJobId}
      onResolveRevision={onResolveRevision}
      onHelperReview={onHelperReview}
      onDispute={onDispute}
      onViewDispute={onViewDispute}
      onRefresh={onRefresh}
      disputeResponse={disputeResponse}
      setDisputeResponse={setDisputeResponse}
      respondingJobId={respondingJobId}
      setRespondingJobId={setRespondingJobId}
      submittingResponse={submittingResponse}
      setSubmittingResponse={setSubmittingResponse}
      withdrawingAppId={withdrawingAppId}
      setWithdrawTarget={setWithdrawTarget}
      uploadingAttachment={uploadingAttachment}
      editingMessageAppId={editingMessageAppId}
      setEditingMessageAppId={setEditingMessageAppId}
      editMessageText={editMessageText}
      setEditMessageText={setEditMessageText}
      savingMessage={savingMessage}
      handleSaveMessage={handleSaveMessage}
      handleAddAttachment={handleAddAttachment}
      handleRemoveAttachment={handleRemoveAttachment}
    />
  );

  if (apps.length === 0) {
    return (
      <div
        className="flex items-stretch h-full"
        style={{
          // Pull the empty-state card past the scroll container's bottom
          // safe-area padding so it bleeds all the way to the panel's
          // bottom edge — like the home page does.
          marginBottom: "calc(-1 * (var(--safe-area-bottom, 0px) + 96px))",
        }}
      >
        <EmptyState
          icon={Briefcase}
          illustration={<EmptyStateIllustration variant="jobs" />}
          eyebrow="No applications"
          title="Nothing in this view yet"
          body="New jobs are posted across Louisiana every day."
          action={
            <>
              <Button onClick={() => navigate("/jobs")} className="rounded-ds-md btn-press">
                <Briefcase className="w-4 h-4 mr-1.5" /> Browse Open Jobs
              </Button>
              <p
                className="font-serif italic text-ds-13 mt-2"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Browse open jobs near you and apply — they&apos;ll collect here as you go.
              </p>
            </>
          }
        />
      </div>
    );
  }

  // The page header (ActivityHeader) owns the only search + status
  // filter — both modes render the already-filtered list. "All" routes
  // through the grouped Sectioned view ("Closed" labels the third
  // section since helper-side rejections and cancelled jobs collapse
  // into one bucket); a specific status renders a flat list.
  const listView = groupByStatus ? (
    <ActivitySectionedView
      tab="applied"
      items={apps}
      getKey={(app) => app.id}
      bucketize={bucketAppliedApp}
      renderItem={renderAppliedCard}
      labels={{ cancelled: "Closed" }}
    />
  ) : (
    // Flat (single-status) list rendered in normal document flow — the
    // same layout primitive the grouped Sectioned view uses (space-y-3 +
    // ds-activity-grid, single column on phone / two columns on wide
    // browser desktop). It intentionally is NOT window-virtualized: the
    // Activity panel scrolls inside its own container (PullToRefreshWrapper),
    // not the window, so a window virtualizer both mismatched the scroll
    // source and forced an explicit absolute list height that re-measured
    // from a fixed estimate on every remount — which is what made switching
    // "All" ↔ a single status visibly jump. Normal flow keeps the two views
    // structurally identical, so toggling between them stays stable.
    <div className="space-y-3 ds-activity-grid">
      {apps.map((app) => (
        <div key={app.id}>{renderAppliedCard(app)}</div>
      ))}
      {/* The "That's everything here." trailing line (mirrored from
          PostedJobsTab) was removed (owner, 2026-08-30). */}
    </div>
  );

  return (
    <>
      {listView}

      {/* Withdraw confirmation — slide-up sheet with dimmed backdrop.
          Asks for a reason BEFORE confirming so the helper has to think
          about why for a beat (gentle friction) and so product gets a
          coded reason mix for the funnel without a custom event. */}
      <Sheet
        open={!!withdrawTarget}
        onOpenChange={(open) => {
          if (!open) {
            setWithdrawTarget(null);
            setWithdrawReason(null);
            setWithdrawDetail("");
          }
        }}
      >
        {/* `max-w-md mx-auto` like MuteSheet — without it this sheet spans the
            full desktop width, so the four reason chips render ~700px wide
            with a 13px label floating in the middle and the confirm button
            becomes a 1400px band. Every other titled sheet in the app shares
            this same `rounded-2xl`, centered-modal treatment now
            (`side="bottom"` stopped being a floor-anchored sheet — see
            sheet.tsx's `sheetVariants`), so there's no bespoke drag handle to
            keep in sync with here: drag-to-dismiss was removed app-wide, not
            just from this one sheet. */}
        {/* Only the STRUCTURAL part of the override survives — the max height
            and inner scroll, for a sheet whose reason list plus textarea can
            outgrow a short phone. The cosmetic half (`px-5 pt-6`, a
            safe-area bottom inset written differently in each of the six
            bottom sheets, and a `border-t-0` for a top border a centred modal
            no longer has) is gone: SheetContent's shared `p-4 sm:p-5` is the
            same padding ramp DialogContent uses. */}
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHero title="Withdraw Application?" />

          <fieldset className="mt-5 space-y-1.5" disabled={!!withdrawingAppId}>
            {/* Quiet olivewood serif prompt, exactly like
                DeclineApplicantSheet's "Choose a reason (optional)". It used
                to be a burnt-sienna uppercase line, which read as a SECOND
                eyebrow above the body — the stack the "one main title"
                decision removed everywhere else — and its wording ("Why are
                you withdrawing?") made "withdraw" the third repetition in one
                sheet, after the title and the confirm button. */}
            <legend
              className="font-serif italic block mb-2 text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Choose a reason <span aria-hidden>*</span>
              <span className="sr-only">(required)</span>
            </legend>
            {/* ONE COLUMN OF FULL-WIDTH ROWS, not a 2-column chip grid.
                Same reasoning the report dialog's picker was rebuilt on: a
                grid of variable-length prose labels cannot be tidy —
                "No longer interested" wraps to two lines while "Other" is one
                word, so the four tiles carried visibly different heights and
                the last one orphaned across the bottom of the grid. Rows give
                every label the same left edge, room to wrap without disturbing
                a neighbour, and no orphan at any count.

                The SELECTED row is `btn-grad-primary` — the glossy primary
                surface. It was a flat 10%-bark tint, i.e. a flat selected
                control, against the standing "primary and selected controls
                are glossy, never flat" rule. */}
            <div className="space-y-1.5">
              {([
                { value: "another_job", label: "Got another job" },
                { value: "schedule_conflict", label: "Schedule conflict" },
                { value: "no_longer_interested", label: "No longer interested" },
                { value: "other", label: "Other" },
              ] as Array<{ value: WithdrawReason; label: string }>).map(({ value, label }) => {
                const active = withdrawReason === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setWithdrawReason(value);
                      if (value !== "other") setWithdrawDetail("");
                    }}
                    aria-pressed={active}
                    // A bare <button>, not the shared <Button>: button.tsx's
                    // base carries `whitespace-nowrap`, which would stop a long
                    // reason wrapping and clip it at 320px. The global
                    // `button { min-height: 44px }` floor still applies.
                    className={`w-full flex items-center gap-3 min-h-[3.5rem] px-3 py-2.5 rounded-ds-md text-left transition-all duration-150 ease-ds-spring active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                        : "bg-secondary/45 border border-border/60 hover:bg-secondary/70 hover:border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
                    }`}
                  >
                    {active && (
                      <Check
                        className="w-[18px] h-[18px] shrink-0"
                        style={{ color: "hsl(var(--parchment))" }}
                        aria-hidden
                      />
                    )}
                    <span
                      className="flex-1 min-w-0 whitespace-normal break-words font-sans font-semibold leading-snug text-ds-14"
                      style={{ color: active ? "hsl(var(--parchment))" : "hsl(var(--ink-deep))" }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
            {withdrawReason === "other" && (
              <Textarea
                value={withdrawDetail}
                onChange={(e) => setWithdrawDetail(e.target.value.slice(0, 240))}
                placeholder="Tell us briefly — helps us improve Louisiana Helpr."
                rows={2}
                aria-label="Withdraw reason — other"
                className="mt-2 rounded-ds-md focus-visible:border-primary/40 text-ds-14 leading-relaxed resize-none"
              />
            )}
          </fieldset>

          {/* Byte-for-byte the action row DeclineApplicantSheet uses — the
              other destructive bottom sheet in the app: escape hatch LEFT as
              an outline button, confirm RIGHT as the filled olivewood button,
              both `flex-1 rounded-ds-md`. This sheet had drifted to the mirror
              image (destructive on the left, a flex-[2] primary "Keep
              application" on the right), so the two confirm sheets taught
              opposite muscle memory. History of the earlier swap:
              Withdraw was a full-width solid red
              `lg` bar with elevation and "Keep application" was a flat grey
              ghost caption, so the eye landed on the irreversible action and
              the escape hatch read as fine print. Side by side, safe action
              filled and leading — the same pair DeclineApplicantSheet uses.
              Withdraw stays enabled and validates on press, which is also what
              makes the two guard toasts in confirmWithdraw reachable; they were
              dead code behind a disabled button, so a helper who hadn't picked
              a reason got no explanation at all. */}
          {/* THE SHARED POPUP FOOTER. This was a hand-rolled
              `flex gap-2` row of two `flex-1` buttons — a third footer
              arrangement, alongside the stacked one every dialog uses and the
              right-aligned one they use from `sm` up. `SheetFooter` is the
              same component `DialogFooter`/`AlertDialogFooter` are, so the
              buttons now stack full-width with the primary on top on a phone
              and sit right-aligned inline on a wide screen, exactly like every
              other popup.

              The confirm was also a hand-written `hsl(var(--olivewood))` fill:
              a FOURTH primary colour in the app, after the glossy bark, the
              destructive red and the burnt sienna. Withdrawing an application
              is reversible — the helper can apply again — so it takes the
              ordinary glossy primary, not a destructive treatment. */}
          <SheetFooter className="mt-5">
            <SheetSecondaryAction
              disabled={!!withdrawingAppId}
              onClick={() => {
                setWithdrawTarget(null);
                setWithdrawReason(null);
                setWithdrawDetail("");
              }}
            >
              Keep It
            </SheetSecondaryAction>
            <SheetPrimaryAction
              disabled={!!withdrawingAppId}
              aria-busy={!!withdrawingAppId}
              onClick={confirmWithdraw}
            >
              {withdrawingAppId ? "Withdrawing…" : "Confirm Withdrawal"}
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
};
