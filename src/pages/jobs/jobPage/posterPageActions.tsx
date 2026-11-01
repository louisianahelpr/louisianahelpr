/**
 * THE POSTER'S ACTIONS, ON THE JOB PAGE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): the step needed now is the big
 * button, and what the Manage job card offered (message, change the date or time, cancel) sits under it as
 * secondary buttons. "Confirm it's still on" opens its confirm sheet HERE (JobConfirmation's own dialog, write and
 * gates), and a poster with no step due gets the next useful thing ("Message Yusef", "Post this job again"),
 * never a generic "Manage job".
 *
 * The money and card steps run HERE too (owner 2026-10-31, the money half): "Approve and release", "Cancel job",
 * "Edit job" and "More options" call usePosterPageFlows, which mounts the Posted card's OWN handlers, dialogs and
 * step controls on this page (createLifecycleHandlers, ActivityDialogs, PostedJobActions). No new money code: the
 * release is still create-payment's, the cancel still the CancellationDialog's fee quote and refund.
 *
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("the poster acts on the job page").
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { JobPageActionRow, type RowAction } from "./JobPageActionRow";
import { JobConfirmation } from "@/components/JobConfirmation";
import { ChangeJobSheet } from "@/components/schedule/ChangeJobSheet";
import { scheduleChangeAllowed, type SeriesCardJob } from "@/components/series/JobSeriesCardControls";
import { fetchSellerCard } from "@/lib/declutter/api";
import { RELEASE_ACTION } from "@/lib/releaseCopy";
import { useJobRescheduled } from "@/hooks/useJobRescheduled";
import { useAgeGate } from "@/hooks/useAgeGate";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { JobPageRow } from "./useJobPage";
import type { PosterPageFlows } from "./usePosterPageFlows";

export type PagePrimary = { label: string; go: () => void; disabled?: boolean };

/** The statuses a poster may still cancel from (the card's own check refuses one the Helpr already set off on). */
const CANCELLABLE = new Set(["open", "accepted"]);
/** A hired Helpr to talk to: booked, under way, being fixed, or done. */
export const HAS_HELPR: ReadonlySet<string> = new Set(["accepted", "in_progress", "revision_requested", "completed", "disputed"]);
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
  flows,
}: {
  job: JobPageRow | null | undefined;
  userId: string;
  /** False for anyone but the poster: no read, no buttons. */
  enabled: boolean;
  /** posterStatusLine(job).id: what the poster is waiting on ("confirm_still_on", "approve", ...). */
  posterWait: string | null;
  open: boolean;
  pending: number;
  /** Re-read the page after a write here (the confirm). */
  onChanged: () => void;
  /** The Posted card's own flows, mounted on this page (usePosterPageFlows). */
  flows: PosterPageFlows;
}): {
  /** The step due now, or Message when none is (the page's lead without an override). */
  primary: PagePrimary | null;
  /** The one row of buttons; `override` is the page's own step (Confirm they've arrived), null for none. */
  row: (override?: PagePrimary | null) => React.ReactNode;
  /** The hidden card (its flows and dialogs). */
  panel: React.ReactNode;
  dialogs: React.ReactNode;
  edit: () => void;
} {
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
  // Q1586(c): "Post this job again" opens /post-job, so under 18 it explains instead (as Posted's own Repost).
  const { gate: ageGate } = useAgeGate();
  if (!enabled || !job) return { primary: null, row: () => null, panel: null, dialogs: null, edit: () => {} };

  const id = encodeURIComponent(job.id);
  const status = job.status ?? "";
  const message = job.helper_id && HAS_HELPR.has(status)
    ? { label: helperFirst ? `Message ${helperFirst}` : "Message your Helpr", go: () => job.helper_id ? navigate(`/messages?jobId=${id}&userId=${job.helper_id}`) : undefined }
    : null;
  // JA-6 (Jobs audit 11-01): not once the Helpr set off or arrived (the same rule as Cancel below).
  const canChange = !!job.date_needed && !job.helper_on_the_way_at && !job.helper_arrived_at
    && scheduleChangeAllowed(job as unknown as SeriesCardJob, userId, "poster");
  // Not once the Helpr set off or arrived: the card's cancel refuses it then (tryCancelJob's tracking check).
  // A never-paid draft is on no Posted list (JOBS-9), so a trip to its card would land on nothing: no Edit or Cancel.
  const draft = jobIsUnfundedDraft(job);
  // JOBS-3: an under-way crew whose every member was reported a no-show is cancelled for a full refund
  // (poster_cancel_job prices no share for an empty roster), so it gets Cancel too.
  const canCancel = !draft && ((CANCELLABLE.has(status) && !job.helper_on_the_way_at && !job.helper_arrived_at) || flows.crewNobodyLeft);
  // The card's other steps (report a no-show, the dispute, a fix asked for, tip and review): "More options" opens it.
  const cardSteps = MORE_ON_CARD.has(status) || (posterWait?.startsWith("overdue_") ?? false);
  // An open job's details (a crew's change only through a request once a member is hired: the card's own rule).
  // JA-48 / JA-49: not while an offer or a booking is out to a Helpr (they are answering the job as it stands).
  const canEdit = !draft && status === "open" && !job.is_group_job && job.direct_offer_status !== "pending";

  const primaryOrMessage: PagePrimary | null =
    posterWait === "confirm_still_on"
      ? { label: "Confirm it's still on", go: () => setConfirmAsk((n) => n + 1) }
      : posterWait === "approve"
      // The card's own CompletionChoiceSheet (the confirm), then create-payment's release (usePosterPageFlows).
      ? { label: RELEASE_ACTION, go: flows.approve, disabled: !flows.ready || flows.completing }
      : open && pending > 0
      // Review opens the applicants themselves (useReviewApplicantsDeepLink), not just the card.
      ? { label: `Review ${pending} applicant${pending === 1 ? "" : "s"}`, go: () => navigate(`/posts?highlight=${id}&applicants=1`) }
      : message
      ? message
      : status === "cancelled"
      ? { label: "Post this job again", go: ageGate("post", () => navigate(`/post-job?rebook=${id}`)) }
      : null;

  // ONE ROW (owner 2026-11-01, JobPageActionRow.tsx): the step due now leads on the right; with none, Message leads on
  // the left. Every other action is the one button beside it, or "More options" opening them all in one tap.
  const pageExtras = (): RowAction[] => [
    canEdit && { key: "edit", label: "Edit job", go: flows.edit, disabled: !flows.ready },
    canChange && { key: "change", label: "Change date or time", go: () => setChangeOpen(true) },
    canCancel && { key: "cancel", label: "Cancel job", go: flows.cancel, disabled: !flows.ready, danger: true },
  ].filter(Boolean) as RowAction[];
  const cardCount = cardSteps ? flows.moreCount : 0;
  const row = (override: PagePrimary | null | undefined) => {
    const step = override !== undefined ? override : primaryOrMessage === message ? null : primaryOrMessage;
    const msg: RowAction | null = message ? { key: "message", label: message.label, go: message.go } : null;
    // No step of the page's own, and the card has one (Review, Tip on a finished job): the card's leads.
    const cardLead = !step && cardSteps && flows.leadCount > 0;
    const lead: RowAction | null = step ? { key: "step", label: step.label, go: step.go, disabled: step.disabled } : cardLead ? null : msg;
    const extras = [...(lead === msg ? [] : msg ? [msg] : []), ...pageExtras()];
    return (
      <>
      {/* The card's own words above its buttons (a crew's Tip rows; why a Tip can't be sent yet). */}
      {cardSteps && <div ref={flows.setAskHost} data-card-ask="" className="empty:hidden" />}
      <JobPageActionRow tag="poster" lead={lead} leadIsStep={!!step} extras={extras} cardCount={cardCount}
        cardLead={cardLead} setCardLeadHost={flows.setLeadHost} setCardSecondHost={flows.setSecondHost} setCardListHost={flows.setListHost} />
      </>
    );
  };
  // The card's own step controls, mounted (hidden) whenever the row is read, so "Approve and release" opens the
  // card's CompletionChoiceSheet and each card action keeps its own confirm step.
  const panel = cardSteps || posterWait === "approve" ? flows.panel : null;

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
            onCantMakeIt={flows.cancel}
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
          onCancelJob={flows.cancel}
        />
      )}
      {flows.dialogs}
    </>
  );
  return { primary: primaryOrMessage, row, panel, dialogs, edit: flows.edit };
}
