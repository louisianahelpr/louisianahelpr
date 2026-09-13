import { useRef, useState } from "react";
import { confirmConsequential } from "@/lib/toastPolicy";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { type Job } from "../activityConstants";
import { derivePosterStep, type PosterStepCtx } from "./steps/posterStepContract";
import { OpenStep } from "./steps/OpenStep";
import { ScheduledStep } from "./steps/ScheduledStep";
import { InProgressStep } from "./steps/InProgressStep";
import { CompletedStep } from "./steps/CompletedStep";
import { DisputedStep } from "./steps/DisputedStep";

interface PostedJobActionsProps {
  job: Job;
  userId: string;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  onBoost: (jobId: string) => void;
  /** True when the job has never been funded, so it is invisible to every
      helper. Boost sells reach on a listing that has none — see PostedJobCard. */
  unfunded?: boolean;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  /**
   * NO LONGER READ HERE — kept only so PostedJobCard keeps compiling while it
   * still passes it.
   *
   * It opened the revision dialog from the `completed` action row, and the
   * server can never accept that: `create-payment`'s `request_revision` branch
   * requires `job.status === 'in_progress'`, and the transition matrix in
   * 20260828020000_cancellation_requires_rpc.sql has no `completed ->
   * revision_requested` edge. The poster typed their note FIRST
   * (ActivityDialogs gates submit on non-empty text), so every tap threw their
   * writing away behind an error. The revision path that DOES work is
   * CompletionChoiceSheet's — offered on the in_progress card, where the
   * server accepts it. Drop this prop from PostedJobCard and Activity.tsx.
   */
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onReport: (job: Job) => void;
  onViewDispute: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  confirmingArrivalJobId: string | null;
  onConfirmWorking: (jobId: string) => void;
  confirmingWorkingJobId: string | null;
  onActionComplete: () => void;
}

/**
 * PostedJobActions — the state-specific action area (pending approval / open /
 * accepted / in-progress / revision / completed / disputed) at the bottom of a
 * PostedJobCard. Extracted verbatim from PostedJobCard; owns the completion
 * sheet, the resolve-dispute confirm, and the dispute-action in-flight state
 * that only this section reads.
 *
 * EVERY job_status must land in a branch, or be classified `false` in
 * STATUS_RENDERS_ACTIONS so the early return sends it out as `null`. A status
 * that falls through them all still renders this component's ruled, padded
 * shell around an empty div — a band of card stock with no controls in it.
 * That is what `pending_approval` did, twice.
 *
 * That sentence used to be the whole safeguard, and it failed twice — a comment
 * cannot fail a build. STATUS_RENDERS_ACTIONS below turns it into a type error.
 */

/**
 * Which statuses this component actually renders controls for.
 *
 * `satisfies Record<Job["status"], boolean>` is the entire point: `Job["status"]`
 * IS the `job_status` DB enum (activityConstants.ts:5 → generated types), so
 * adding a value to that enum and regenerating types makes THIS OBJECT a
 * compile error until somebody classifies the new status. The failure mode this
 * replaces is silent and visual — a status with no branch fell through the JSX
 * chain below and left the component's bordered `px-4 py-3` shell wrapped
 * around an empty `space-y-2`, i.e. a ruled band of blank card stock where the
 * poster's controls should be. It shipped that way for `pending_approval`
 * twice — once with no branch, and again after its branch was deleted as
 * residue without this map being updated to match. A comment saying "every status must land in a branch" cannot
 * enforce itself; this can.
 *
 * `false` is a real answer, not an omission — it means "this status
 * deliberately has no actions here", and the reason belongs beside it.
 */
const STATUS_RENDERS_ACTIONS = {
  open: true,
  accepted: true,
  in_progress: true,
  revision_requested: true,
  completed: true,
  disputed: true,
  /**
   * FALSE, and the key stays. Nothing in the product can produce this status:
   * the `businesses` table it belongs to does not exist in the database,
   * `initialStatus` has zero call sites so the post flow can never write it,
   * and there is no `/business` route for the approver notification to link
   * to. The only rows carrying it are seed fixtures. The key is kept because
   * `satisfies Record<Job["status"], boolean>` requires it — `job_status` is
   * still a DB enum value — and because `false` is the answer that routes it
   * through the early return below, which renders NOTHING. Deleting the key
   * would be a compile error, which is the guard doing its job; deleting the
   * branch without setting this to `false` would put the empty bordered band
   * back, which is the bug that started this.
   */
  pending_approval: false,
  /** Its one move, "Re-post This Job", is rendered by the card, not here. */
  cancelled: false,
} as const satisfies Record<Job["status"], boolean>;
export function PostedJobActions({
  job,
  userId,
  helperNames,
  completedJobMeta,
  onBoost,
  unfunded = false,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  // onRevision — deliberately not destructured; see the interface note.
  onNoShow,
  onTip,
  onReview,
  onDispute,
  onReport,
  onViewDispute,
  onConfirmArrival,
  confirmingArrivalJobId,
  onConfirmWorking,
  confirmingWorkingJobId,
  onActionComplete,
}: PostedJobActionsProps) {
  // Own instant-release flag — when on, the 24h review countdown is replaced
  // by an honest "releases within minutes" line (owner, 2026-08-24). Cast:
  // generated types predate migration 20260824238000.
  const { profile: _ownProfile } = useCurrentUser();
  const instantReleaseOn = !!(_ownProfile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  const navigate = useNavigate();
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  // Guards the Resolve & Pay / Escalate to Admin buttons while their
  // supabase UPDATE is in-flight — prevents double-tap submission.
  const [disputeActing, setDisputeActing] = useState(false);
  // `disputeActing` is state: two taps in one frame both read false and both
  // sent create-payment release (the server does not refuse a concurrent
  // duplicate). The ref sees the first.
  const disputeInFlight = useRef(false);
  // Resolving a dispute RELEASES THE FULL ESCROW. It was a single tap on a
  // chip whose label ("Mark Resolved") and spoken name ("Mark this dispute
  // resolved") both said "close a ticket" and neither said "move money" —
  // while Approve, the exact same money action one state earlier, opens
  // CompletionChoiceSheet first. Same consequence, same class of confirm.
  // ESCALATE, BEHIND A CONFIRM. This ran straight from the chip's onClick:
  // one tap, no sheet, no undo. It is protective (it is the only move that
  // stops the auto-release at the deadline) but it is also one-way for the
  // poster — once escalated the Resolve & Pay chip is gone and a human
  // decides. Measured 2026-09-07: a single tap on the danger-toned chip
  // escalated a live dispute with nothing asked. Resolve & Pay has confirmed
  // through BrandConfirmDialog since it was renamed; this is the same bar.
  const escalateDispute = async () => {
    setDisputeActing(true);
    try {
      // BELONGS IN AN RPC, AND CANNOT BE FIXED FROM HERE.
      //
      // ONE SERVER-SIDE CALL. This block used to be a client
      // write plus a browser fan-out, and both halves were wrong.
      //
      // The write set only `jobs.dispute_status` — the
      // denormalised mirror — because there was no RPC to write
      // both sides, and the `disputes` row stayed 'open'.
      //
      // The fan-out reached NOBODY and failed without an error:
      // `user_roles` has exactly one policy an ordinary user can
      // read (`auth.uid() = user_id`), so the select returned
      // `{ data: [], error: null }`, `adminErr` was null, the loop
      // never ran, and the toast still said an admin would review
      // it. Escalation is the ONLY move that stops
      // auto-resolve-disputes releasing the whole escrow at the
      // deadline, so "we told the admins" being quietly false was
      // the most expensive silent success on this card.
      //
      // `rpc_escalate_dispute` (20260907034826) does both server-
      // side. It deliberately does NOT write
      // `disputes.status = 'escalated'` — that value is outside
      // the table's CHECK — and leaves `jobs.status` alone,
      // because AdminDisputes builds its queue from
      // `jobs.status = 'disputed'` (AdminDisputes.tsx:66). Writing
      // either would delete escalated disputes from the queue that
      // exists to action them.
      try {
        const { error: escalateErr } = await (supabase.rpc as never as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { code?: string; message?: string } | null }>)(
          "rpc_escalate_dispute",
          { _job_id: job.id },
        );
        if (escalateErr) {
          // PGRST202 = the RPC has not deployed yet. Migrations
          // land on merge, so there is a window where the client
          // is ahead of the database; a deploy-lag miss is not a
          // reason to tell the poster their escalation failed
          // when it may simply be a minute early.
          if (String(escalateErr.code ?? "") !== "PGRST202") throw escalateErr;
          report(escalateErr, { tags: { source: "PostedJobCard.escalateDispute.deployLag" } });
        }
      } catch (err) {
        hapticError();
        toast.error(mutationErrorMessage(err, "We couldn't escalate that — please try again."));
        return;
      }
      hapticSuccess();
      // Escalating froze the payout and handed the decision to a
      // human, and the card said nothing about it.
      confirmConsequential("Escalated — an admin will review this and decide.");
      onActionComplete();
    } finally {
      disputeInFlight.current = false;
      setDisputeActing(false);
    }
  };
  const [resolveConfirmOpen, setResolveConfirmOpen] = useState(false);
  const [escalateConfirmOpen, setEscalateConfirmOpen] = useState(false);

  // Lifted out of the chip's onClick so the confirm dialog below can call the
  // same code path — the chip now only opens the dialog. Body is otherwise
  // unchanged apart from the success toast it never had.
  const resolveDisputeAndRelease = async () => {
    if (disputeInFlight.current) return;
    disputeInFlight.current = true;
    setDisputeActing(true);
    try {
      // Two steps, both server-side: close the dispute record
      // (rpc_withdraw_dispute hands the job back to 'in_progress'), then
      // settle through the SAME release path an ordinary completion uses.
      // The old version wrote status='completed' straight from the client and
      // promised the helper payment that no release path would ever pick up —
      // escrow stayed held forever.
      const { error } = await supabase.rpc("rpc_withdraw_dispute" as never, { _job_id: job.id } as never);
      // REPORTED, not just toasted. This call failed 100% of the time from
      // 20260901032007 until 20260907034644 — the dispute column whitelist
      // pinned `decided_at`, which the RPC stamps in the same statement as the
      // status flip, so every tap came back 42501 "only the evidence on a
      // dispute may be changed". Nothing logged it: the toast said "please try
      // again", the user did, and it failed identically, forever. A money
      // control that is dead for months with zero Sentry events is the whole
      // argument for this line.
      if (error) {
        report(error, { tags: { source: "PostedJobCard.withdrawDispute" }, context: { job_id: job.id } });
        hapticError();
        // Wording unchanged: `mutationErrorMessage` returns its fallback for a
        // plain PostgrestError, so routing through it would only look like it
        // was doing something.
        toast.error("We couldn't mark that resolved — please try again.");
        return;
      }
      const { data: releaseData, error: releaseError } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId: job.id } });
      if (releaseError || releaseData?.error) {
        report(releaseError ?? new Error(String(releaseData?.error)), { tags: { source: "PostedJobCard.resolveDisputeRelease" }, context: { job_id: job.id } });
        hapticError();
        toast.error("Dispute closed, but the payment didn't release. Contact support so we can finish it.");
        onActionComplete();
        return;
      }
      if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, // `?job=` — `completed` is a legacy key (the chip is "Done"), and the
        // payment is still releasing, so the bucket is not settled yet.
        type: "payment", link: `/my-jobs?job=${job.id}` });
      hapticSuccess();
      // The one action in this card that moves money and said NOTHING when it
      // landed — every sibling handler (confirm arrival, confirm working)
      // toasts. Silence after releasing escrow reads as "did that work?".
      confirmConsequential("Dispute resolved — payment released to your Helpr.");
      onActionComplete();
    } finally {
      setDisputeActing(false);
    }
  };

  // THE EXHAUSTIVENESS GATE — see STATUS_RENDERS_ACTIONS above.
  //
  // A cancelled job has no actions here — its one move ("Re-post This Job")
  // is rendered by the card itself. Without this the component still returned
  // its bordered, padded shell around an empty div, so every cancelled card
  // carried a ~44px band of ruled card stock below the button with nothing in
  // it (owner: "remove this spacing").
  //
  // The `?? false` is the other half: a status the generated types have never
  // heard of (types.ts is a SNAPSHOT of the DB enum, so it can lag a migration
  // by a deploy) is missing from the map at RUNTIME, and falls out here as
  // "renders nothing" rather than as the empty band. Reported, not swallowed —
  // an unknown status means the card is silently offering a poster no controls
  // at all, which we want to see in Sentry rather than in a screenshot.
  if (!(STATUS_RENDERS_ACTIONS[job.status] ?? false)) {
    if (!(job.status in STATUS_RENDERS_ACTIONS)) {
      report(new Error(`PostedJobActions: unhandled job status "${job.status}"`), {
        tags: { area: "activity", jobId: job.id, status: String(job.status) },
      });
    }
    return null;
  }
  const step = derivePosterStep(job.status);
  if (!step) return null; // unreachable — STATUS_RENDERS_ACTIONS already returned

  /* Everything a step could need, built once. The steps are pure: they read
     this and render through the shared JobStepCard shell, so no state of this
     card can draw its own wrapper, its own spacing, or its own row width. */
  const ctx: PosterStepCtx = {
    job,
    userId,
    helperNames,
    completedJobMeta,
    unfunded,
    completingJobId,
    confirmingArrivalJobId,
    confirmingWorkingJobId,
    instantReleaseOn,
    navigate,
    onBoost,
    onEdit,
    onCancel,
    onComplete,
    onNoShow,
    onTip,
    onReview,
    onDispute,
    onReport,
    onViewDispute,
    onConfirmArrival,
    onConfirmWorking,
    onActionComplete,
    completionSheetOpen,
    setCompletionSheetOpen,
    disputeActing,
    resolveConfirmOpen,
    setResolveConfirmOpen,
    escalateConfirmOpen,
    setEscalateConfirmOpen,
    escalateDispute,
    resolveDisputeAndRelease,
  };

  switch (step) {
    case "open":
      return <OpenStep {...ctx} />;
    case "scheduled":
      return <ScheduledStep {...ctx} />;
    case "in_progress":
      return <InProgressStep {...ctx} />;
    case "completed":
      return <CompletedStep {...ctx} />;
    case "disputed":
      return <DisputedStep {...ctx} />;
  }
}
