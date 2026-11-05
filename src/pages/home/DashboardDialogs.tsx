import { Suspense, type Dispatch, type SetStateAction } from "react";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardData } from "@/hooks/useDashboardData";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { ApplyBody, ApplyConfirmDialog, BirthdayPopup, JobDetailDialog, ReportDialog } from "./dashboardLazyParts";
import { QuickApplyHandler } from "./QuickApplyHandler";
import type { useApplyFlow } from "./useApplyFlow";
import type { useDetailJob } from "./useDetailJob";
import type { useSaveJob } from "./useSaveJob";

/*
 * Jobs > Browse's dialogs, moved out of src/pages/home/Dashboard.tsx unchanged (Q806, the god-component
 * ratchet): the job sheet with its apply form, then the report dialog, the birthday popup, the quick-apply deep
 * link and the standalone apply sheet. Same order as before, so the same DOM. State stays in Dashboard.
 */

type ApplyFlow = ReturnType<typeof useApplyFlow>;
type DashboardData = ReturnType<typeof useDashboardData>;
type DetailJob = ReturnType<typeof useDetailJob>;
/** The apply step's fields, the same for the detail sheet's ApplyBody and the ApplyConfirmDialog. */
export type ApplyFieldProps = { platformFee: DashboardData["platformFee"] } & Pick<
  ApplyFlow,
  "applyMessage" | "setApplyMessage" | "applyTimeSuggestion" | "setApplyTimeSuggestion" | "applyFiles" | "setApplyFiles" | "applyLoading"
>;

export function DashboardDetailSheet({
  detailJob,
  effectiveFee,
  allJobs,
  savedJobIds,
  handleToggleSave,
  userLoc,
  userId,
  setConfirmApplyJobId,
  closeDetailJob,
  handleApplyRequest,
  handleApplyConfirm,
  setReportJobId,
  openDetailJob,
  applyFieldProps,
}: {
  detailJob: EnrichedJob;
  effectiveFee: number;
  allJobs: EnrichedJob[];
  savedJobIds: Set<string>;
  handleToggleSave: ReturnType<typeof useSaveJob>["handleToggleSave"];
  userLoc: ReturnType<typeof useDashboardFilters>["userLoc"];
  userId: string | undefined;
  setConfirmApplyJobId: ApplyFlow["setConfirmApplyJobId"];
  closeDetailJob: DetailJob["closeDetailJob"];
  handleApplyRequest: ApplyFlow["handleApplyRequest"];
  handleApplyConfirm: ApplyFlow["handleApplyConfirm"];
  setReportJobId: Dispatch<SetStateAction<string | null>>;
  openDetailJob: DetailJob["openDetailJob"];
  applyFieldProps: ApplyFieldProps;
}) {
  return (
    <Suspense fallback={null}>
      <JobDetailDialog
        job={detailJob}
        effectiveFee={effectiveFee}
        allJobs={allJobs}
        isSaved={detailJob ? savedJobIds.has(detailJob.id) : false}
        onToggleSave={handleToggleSave}
        userLat={userLoc?.status === "ready" ? userLoc.lat : null}
        userLng={userLoc?.status === "ready" ? userLoc.lng : null}
        /* Dismissing the sheet abandons the apply too. Without clearing
           the pending id, closing from the apply step left
           confirmApplyJobId set with no detail sheet to host it — and the
           standalone deep-link sheet below (which renders whenever that id
           is set and does NOT match an open detail job) would immediately
           pop the apply form back up on the bare feed. */
        onClose={() => { setConfirmApplyJobId(null); closeDetailJob(); }}
        onApply={handleApplyRequest}
        onReport={setReportJobId}
        onSelect={openDetailJob}
        /* THE APPLY FORM, ON THIS SAME SHEET — NO SECOND STEP.
           Applying was a separate centred AlertDialog, then the second
           STEP of this sheet, and is now simply part of it (owner,
           2026-09-09: "collapse the TWO steps into ONE ... one less tap
           to apply"). useApplyFlow still owns the mutation; only where
           the markup mounts and when the guards run has changed.

           WITHHELD ON YOUR OWN POST, synchronously. `user` is available
           here without a round trip, while the sheet's own `viewerUserId`
           resolves a beat after open — so deciding it here is what stops
           a poster seeing an apply form flash on their own job. The sheet
           falls back to the footer, which says "This is your post".

           THE GUARDS MOVED TO THE SUBMIT. `handleApplyRequest` (offline,
           impersonation, signed out, own post) used to run on the
           Continue tap. There is no Continue, so it runs on Apply Now,
           immediately before the mutation — same guards, same refusals,
           one tap later. */
        /* NO <Suspense> OF ITS OWN — IT SHARES THE SHEET'S, ON PURPOSE.
           ApplyBody is a separate lazy chunk. Wrapped in its own
           `<Suspense fallback={null}>`, the sheet painted WITHOUT its apply
           form and then INSERTED ~340px of it when the chunk landed. The
           sheet is centred and content-sized, so that insertion moved both
           edges: measured on the production bundle at 375x812, 4x CPU
           throttling, 400kbps/400ms link, the top edge sat still at y=227.5
           for a full second and then jumped to y=56.8 — 170.7px in ONE
           frame, on a surface the reader was already reading. That is the
           "very jumpy on open then settles" reported from TestFlight
           1.0.4/7110, and it was the largest contributor by an order of
           magnitude (next was 28.9px, and only on a credential-gated job).

           Dropping the inner boundary lets the suspension bubble to the
           sheet's own <Suspense> just below — the one already withholding
           JobDetailDialog's chunk. Both lazy imports start in the same
           commit, so the sheet waits for max(dialog, form) instead of
           painting at dialog and reflowing at form: one paint, final
           height, nothing moves. Not a skeleton and not a delay — it is
           refusing to split ONE surface across two paints. Do not
           "optimise" this back into a boundary of its own. */
        applyForm={
          detailJob.customer_id !== userId ? (
            <ApplyBody
              open
              onClose={() => setConfirmApplyJobId(null)}
              confirmApplyJob={detailJob}
              {...applyFieldProps}
              hideEarnings
              handleApplyConfirm={async () => {
                const accepted = await handleApplyRequest(detailJob.id);
                if (accepted === false) return;
                // Submitting takes the whole sheet down — the helpr is
                // done with this job either way, and the success toast
                // is the confirmation. The id is passed explicitly:
                // handleApplyRequest set it in state one tick ago and
                // this render cannot see it yet.
                handleApplyConfirm(detailJob.id);
                closeDetailJob();
              }}
            />
          ) : null
        }
      />
    </Suspense>
  );
}

export function DashboardDialogs({
  reportJobId,
  setReportJobId,
  dateOfBirth,
  firstName,
  searchParams,
  user,
  allJobs,
  openDetailJob,
  clearQuickApplyParam,
  applicationSent,
  closeApplicationSent,
  viewApplication,
  platformFee,
  confirmApplyJobId,
  detailJobId,
  setConfirmApplyJobId,
  confirmApplyJob,
  applyFieldProps,
  handleApplyConfirm,
}: {
  reportJobId: string | null;
  setReportJobId: Dispatch<SetStateAction<string | null>>;
  dateOfBirth: NonNullable<DashboardData["profile"]>["date_of_birth"] | undefined;
  firstName: string;
  searchParams: URLSearchParams;
  user: DashboardData["user"];
  allJobs: EnrichedJob[];
  openDetailJob: DetailJob["openDetailJob"];
  clearQuickApplyParam: () => void;
  applicationSent: ApplyFlow["applicationSent"];
  closeApplicationSent: ApplyFlow["closeApplicationSent"];
  viewApplication: ApplyFlow["viewApplication"];
  platformFee: DashboardData["platformFee"];
  confirmApplyJobId: ApplyFlow["confirmApplyJobId"];
  detailJobId: string | undefined;
  setConfirmApplyJobId: ApplyFlow["setConfirmApplyJobId"];
  confirmApplyJob: ApplyFlow["confirmApplyJob"];
  applyFieldProps: ApplyFieldProps;
  handleApplyConfirm: ApplyFlow["handleApplyConfirm"];
}) {
  return (
    <>
    {reportJobId && (
      <Suspense fallback={null}>
        <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />
      </Suspense>
    )}

    {/* Birthday greeting — a popup, not chrome. It used to be mounted as a
        sibling of the (now removed) app bar inside PageScaffold's `header`
        slot; it lives with the other overlays now. Still mounted on every
        Dashboard render — it self-hides unless today is the user's birthday. */}
    <Suspense fallback={null}>
      <BirthdayPopup
        dateOfBirth={dateOfBirth}
        firstName={firstName}
        deferred={false}
      />
    </Suspense>

    {/* A job-match notification opens THE JOB SHEET, not a toast (owner,
        2026-09-11). `openDetailJob` is the exact same entry point a tap on
        a feed card uses — it snapshots the feed scroll and mirrors `?job=`
        — so the deep link and the card converge on one surface. The
        `quickApply` param is then dropped with a functional REPLACE, which
        is what keeps this off the replaceState-throttle path: one write, no
        `setSearchParams` loop, and Back can't re-fire the link. */}
    <QuickApplyHandler
      searchParams={searchParams}
      user={user}
      allJobs={allJobs}
      onOpenJob={openDetailJob}
      onHandled={clearQuickApplyParam}
    />


    {/* STANDALONE apply sheet — only for the QuickApply deep link
        (`?apply=<jobId>`), where no detail sheet is open to host the step.
        When the detail sheet IS open it renders the apply step itself, and
        mounting this too would stack a second surface over it. */}
    <ApplicationSentDialog sent={applicationSent} onClose={closeApplicationSent} onView={viewApplication} platformFee={platformFee} />
    {confirmApplyJobId && confirmApplyJobId !== detailJobId && (
      <Suspense fallback={null}>
        <ApplyConfirmDialog
          open={!!confirmApplyJobId}
          onClose={() => setConfirmApplyJobId(null)}
          confirmApplyJob={confirmApplyJob}
          {...applyFieldProps}
          handleApplyConfirm={handleApplyConfirm}
        />
      </Suspense>
    )}
    </>
  );
}
