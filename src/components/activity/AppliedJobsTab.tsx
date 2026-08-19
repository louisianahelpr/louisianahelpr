import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticLight, hapticSuccess } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Briefcase } from "lucide-react";
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
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
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
  apps, highlightAppId, expandedJobId, setExpandedJobId,
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
    if (error || !saved || saved.length === 0) {
      hapticError();
      toast.error("Couldn't save your note — try again?");
    } else {
      hapticSuccess();
      toast.success("Message updated");
      onRefresh();
    }
    setSavingMessage(false);
    setEditingMessageAppId(null);
  }, [editMessageText, onRefresh]);

  const confirmWithdraw = useCallback(async () => {
    if (!withdrawTarget) return;
    if (!withdrawReason) { hapticError(); toast.error("Pick a reason to continue"); return; }
    if (withdrawReason === "other" && withdrawDetail.trim().length < 3) {
      hapticError();
      toast.error("Add a bit more detail");
      return;
    }
    const { appId, jobTitle, jobId } = withdrawTarget;
    setWithdrawingAppId(appId);
    // Signal the destructive intent with an error haptic at the moment
    // of confirmed withdrawal — matches the task spec and gives tactile
    // confirmation that the irreversible action is being taken.
    hapticError();
    const { error } = await supabase.from("applications").delete().eq("id", appId).eq("helper_id", userId);
    if (error) {
      toast.error("Couldn't withdraw that one — give it another try?");
    } else {
      // Best-effort log — fire-and-forget, never blocks the toast.
      logWithdrawReason(appId, { reason: withdrawReason, detail: withdrawDetail }, jobId);
      toast.success(`Withdrawn from "${jobTitle}".`);
      onRefresh();
    }
    setWithdrawingAppId(null);
    setWithdrawTarget(null);
    setWithdrawReason(null);
    setWithdrawDetail("");
  }, [withdrawTarget, userId, withdrawReason, withdrawDetail]);

  const handleAddAttachment = useCallback(async (appId: string, jobId: string, currentUrls: string[], file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("That file's too large — keep it under 5 MB"); return; }
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
    toast.success("Attachment added");
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
    toast.success("Attachment removed");
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
      expandedJobId={expandedJobId}
      setExpandedJobId={setExpandedJobId}
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
          title="Nothing in this view yet."
          body="New jobs are posted across Louisiana every day."
          action={
            <>
              <Button onClick={() => navigate("/jobs")} className="rounded-ds-md btn-press">
                <Briefcase className="w-4 h-4 mr-1.5" /> Browse open jobs
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
        <SheetContent
          side="bottom"
          className="rounded-t-[20px] border-t-0 px-5 pt-6 pb-[calc(var(--safe-area-bottom,0px)_+_24px)]"
        >
          {/* Drag-handle affordance */}
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
          <SheetHero
            eyebrow="Withdraw"
            title="Withdraw application?"
          />

          <fieldset className="mt-5 space-y-1.5" disabled={!!withdrawingAppId}>
            <legend
              className="font-serif italic uppercase block mb-1.5 text-ds-10"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              Why are you withdrawing?
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
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
                    className={`px-3 py-2 rounded-ds-md text-ds-13 font-medium transition-all active:scale-[0.97] ${
                      active
                        ? "bg-primary/10 text-primary border border-primary/35"
                        : "bg-card text-foreground border border-[hsl(var(--border)/0.6)] glass-press hover:bg-secondary/40"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {withdrawReason === "other" && (
              <Textarea
                value={withdrawDetail}
                onChange={(e) => setWithdrawDetail(e.target.value.slice(0, 240))}
                placeholder="Tell us briefly — helps us improve Helpr."
                rows={2}
                aria-label="Withdraw reason — other"
                className="mt-2 rounded-ds-md focus-visible:border-primary/40 text-ds-14 leading-relaxed resize-none"
              />
            )}
          </fieldset>

          <div className="mt-5 space-y-2.5">
            <Button
              size="lg"
              variant="destructive"
              className="w-full rounded-ds-md btn-press text-ds-15 font-semibold"
              disabled={
                !!withdrawingAppId ||
                !withdrawReason ||
                (withdrawReason === "other" && withdrawDetail.trim().length < 3)
              }
              onClick={confirmWithdraw}
            >
              {withdrawingAppId ? "Withdrawing…" : "Withdraw"}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full rounded-ds-md btn-press text-ds-15 font-medium text-muted-foreground hover:text-foreground"
              disabled={!!withdrawingAppId}
              onClick={() => {
                setWithdrawTarget(null);
                setWithdrawReason(null);
                setWithdrawDetail("");
              }}
            >
              Keep application
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
