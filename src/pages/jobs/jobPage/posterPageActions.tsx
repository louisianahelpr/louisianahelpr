/**
 * THE POSTER'S ACTIONS, ON THE JOB PAGE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): the step needed now is the big
 * button, and what the Manage job card offered (message, change the date or time, cancel) sits under it as
 * secondary buttons. "Confirm it's still on" opens its confirm sheet HERE (JobConfirmation's own dialog, write and
 * gates), and a poster with no step due gets the next useful thing ("Message Yusef", "Post this job again"),
 * never a generic "Manage job".
 *
 * Still on the Posted card, through a one-shot request (faceActionRequest) the card's own control answers: the
 * edit (EditJobDialog), the release ("Approve and release", the create-payment money path) and the cancel (the fee quote, refund and the
 * Helpr-already-on-the-way check live in the card's CancellationDialog flow). Both are money writes; moving them
 * here is its own reviewed change.
 *
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("the poster acts on the job page").
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { JobConfirmation } from "@/components/JobConfirmation";
import { ChangeJobSheet } from "@/components/schedule/ChangeJobSheet";
import { scheduleChangeAllowed, type SeriesCardJob } from "@/components/series/JobSeriesCardControls";
import { requestFaceAction } from "@/components/job-card/faceActionRequest";
import { fetchSellerCard } from "@/lib/declutter/api";
import { RELEASE_ACTION } from "@/lib/releaseCopy";
import { useJobRescheduled } from "@/hooks/useJobRescheduled";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { JobPageRow } from "./useJobPage";
import type { PosterWait } from "@/components/job-card/jobStatusLine";

export type PagePrimary = { label: string; go: () => void; disabled?: boolean };

/** The statuses a poster may still cancel from (the card's own check refuses one the Helpr already set off on). */
const CANCELLABLE = new Set(["open", "accepted"]);
/** A hired Helpr to talk to: booked, under way, being fixed, or done. */
const HAS_HELPR = new Set(["accepted", "in_progress", "revision_requested", "completed", "disputed"]);
/** Statuses whose card carries steps this page does not draw yet (no-show, dispute, revision, tip and review). */
const MORE_ON_CARD = new Set(["in_progress", "revision_requested", "completed", "disputed"]);

export function usePosterPageActions({
  job,
  userId,
  enabled,
  posterWait,
  open,
  pending,
  onChanged,
}: {
  job: JobPageRow | null | undefined;
  userId: string;
  /** False for anyone but the poster: no read, no buttons. */
  enabled: boolean;
  posterWait: PosterWait | null;
  open: boolean;
  pending: number;
  /** Re-read the page after a write here (the confirm). */
  onChanged: () => void;
}): { primary: PagePrimary | null; secondary: React.ReactNode; dialogs: React.ReactNode; edit: () => void } {
  const navigate = useNavigate();
  const helperId = enabled ? job?.helper_id ?? null : null;
  // "Yusef" from the Helpr's card, the read PostedBy already shares (seller-card key).
  const helperCard = useQuery({ queryKey: ["declutter", "seller-card", helperId], queryFn: () => fetchSellerCard(helperId!), enabled: !!helperId });
  const helperFull = (helperCard.data?.name ?? "").trim();
  const helperFirst = helperFull.split(/\s+/)[0] || null;
  const rescheduled = useJobRescheduled(job?.id ?? "", enabled && job?.status === "accepted");
  // Each tap remounts the confirm, so "Not now" then a second tap opens it again.
  const [confirmAsk, setConfirmAsk] = useState(0);
  const [changeOpen, setChangeOpen] = useState(false);
  if (!enabled || !job) return { primary: null, secondary: null, dialogs: null, edit: () => {} };

  const id = encodeURIComponent(job.id);
  const status = job.status ?? "";
  const toCard = (action: "approve" | "cancel" | "edit" | "open") => {
    requestFaceAction(job.id, action);
    navigate(`/posts?highlight=${id}&manage=1`);
  };
  const message = job.helper_id && HAS_HELPR.has(status)
    ? { label: helperFirst ? `Message ${helperFirst}` : "Message your Helpr", go: () => navigate(`/messages?jobId=${id}&userId=${job.helper_id}`) }
    : null;
  const canChange = !!job.date_needed && scheduleChangeAllowed(job as unknown as SeriesCardJob, userId, "poster");
  // Not once the Helpr set off or arrived: the card's cancel refuses it then (tryCancelJob's tracking check).
  // A never-paid draft is on no Posted list (JOBS-9), so a trip to its card would land on nothing: no Edit or Cancel.
  const draft = jobIsUnfundedDraft(job);
  const canCancel = !draft && CANCELLABLE.has(status) && !job.helper_on_the_way_at && !job.helper_arrived_at;
  // The card's other steps (report a no-show, the dispute, a fix asked for, tip and review): "More options" opens it.
  const cardSteps = MORE_ON_CARD.has(status) || (posterWait?.startsWith("overdue_") ?? false);
  // An open job's details (a crew's change only through a request once a member is hired: the card's own rule).
  const canEdit = !draft && status === "open" && !job.is_group_job;

  const primary: PagePrimary | null =
    posterWait === "confirm_still_on"
      ? { label: "Confirm it's still on", go: () => setConfirmAsk((n) => n + 1) }
      : posterWait === "approve"
      ? { label: RELEASE_ACTION, go: () => toCard("approve") }
      : open && pending > 0
      // Review opens the applicants themselves (useReviewApplicantsDeepLink), not just the card.
      ? { label: `Review ${pending} applicant${pending === 1 ? "" : "s"}`, go: () => navigate(`/posts?highlight=${id}&applicants=1`) }
      : message
      ? message
      : status === "cancelled"
      ? { label: "Post this job again", go: () => navigate(`/post-job?rebook=${id}`) }
      : null;

  const buttons = [
    message && primary !== message && (
      <Button key="message" variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={message.go}>
        {message.label}
      </Button>
    ),
    canEdit && (
      <Button key="edit" variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={() => toCard("edit")}>
        Edit job
      </Button>
    ),
    canChange && (
      <Button key="change" variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={() => setChangeOpen(true)}>
        Change date or time
      </Button>
    ),
    canCancel && (
      <Button key="cancel" variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15 text-destructive" onClick={() => toCard("cancel")}>
        Cancel job
      </Button>
    ),
    cardSteps && (
      <Button key="more" variant="outline" size="lg" className="min-w-0 flex-1 rounded-full text-ds-15" onClick={() => toCard("open")}>
        More options
      </Button>
    ),
  ].filter(Boolean);
  const secondary = buttons.length > 0 ? <div data-poster-actions="" className="flex flex-wrap gap-2">{buttons}</div> : null;

  const dialogs = (
    <>
      {confirmAsk > 0 && job.date_needed && (
        // The card variant's own sheet; its card face stays hidden (the page's tracker says the step).
        <div hidden data-poster-confirm-host="">
          <JobConfirmation
            key={confirmAsk}
            openNow
            jobTitle={job.title}
            jobId={job.id}
            isOwner
            isHelper={false}
            posterConfirmedAt={job.poster_confirmed_at ?? null}
            helperConfirmedAt={job.helper_confirmed_at ?? null}
            helperDayofConfirmedAt={job.helper_dayof_confirmed_at ?? null}
            dateNeeded={job.date_needed}
            startTime={job.start_time}
            jobStatus={status}
            helperOnTheWayAt={job.helper_on_the_way_at ?? null}
            helperArrivedAt={job.helper_arrived_at ?? null}
            otherFirstName={helperFirst}
            rescheduled={rescheduled}
            onConfirm={onChanged}
            onCantMakeIt={() => toCard("cancel")}
          />
        </div>
      )}
      {canChange && job.date_needed && (
        <ChangeJobSheet
          open={changeOpen}
          onOpenChange={setChangeOpen}
          jobId={job.id}
          jobTitle={job.title}
          helperName={helperFull || "your Helpr"}
          userId={userId}
          dateNeeded={job.date_needed}
          startTime={job.start_time ?? null}
          onCancelJob={() => toCard("cancel")}
        />
      )}
    </>
  );
  return { primary, secondary, dialogs, edit: () => toCard("edit") };
}
