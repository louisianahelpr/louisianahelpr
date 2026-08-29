import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { fireSuccessMoment } from "@/lib/successMoment";
import type { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import type { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import { awardBlockFromError, posterAwardBlockMessage, type AwardBlockReason } from "@/lib/awardGate";
import type { User as SupaUser } from "@supabase/supabase-js";
import type {
  Job,
  Application,
  EnrichedApplication,
} from "@/components/activity/activityConstants";
import type { OptimisticJobCache } from "./types";

/**
 * Dependencies for the offer/acceptance-phase handlers, extracted verbatim
 * from useActivityActions. All state setters, cache helpers and gate checks
 * used by the accept/decline flow are passed in so the handlers behave
 * identically to their in-hook originals.
 */
export interface OfferHandlersDeps extends OptimisticJobCache {
  user: SupaUser | null;
  refresh: () => void | Promise<unknown>;
  setStatusFilter: (filter: string) => void;
  /**
   * The acceptance gate: payout-ready AND Stripe-identity-verified, from one
   * live Stripe read. Replaces the previous pair of gates (a Connect status
   * probe plus an `idv_status = 'verified'` check) — see src/lib/awardGate.ts
   * for why two gates disagreeing about the word "verified" was the problem.
   */
  checkHelperAwardEligibility: ReturnType<typeof useStripeConnectCheck>["checkHelperAwardEligibility"];
  triggerPushNudge: ReturnType<typeof usePushPermissionNudge>;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  setApplications: React.Dispatch<React.SetStateAction<EnrichedApplication[]>>;
  setInlineApplicants: React.Dispatch<React.SetStateAction<Record<string, EnrichedApplication[]>>>;
  deadlineDialogApp: EnrichedApplication | null;
  setDeadlineDialogApp: (app: EnrichedApplication | null) => void;
  setPendingAcceptApp: (app: Application | null) => void;
  setAwardBlockReason: (reason: AwardBlockReason | null) => void;
  setW9Context: (ctx: { jobId: string; businessId: string | null } | null) => void;
  setW9DialogOpen: (open: boolean) => void;
  setRespondingHelperAppId: (id: string | null) => void;
}

export function createOfferHandlers(deps: OfferHandlersDeps) {
  const {
    user,
    refresh,
    setStatusFilter,
    checkHelperAwardEligibility,
    triggerPushNudge,
    optimisticallyPatchJob,
    rollbackActivity,
    selectedJob,
    setSelectedJob,
    setApplications,
    setInlineApplicants,
    deadlineDialogApp,
    setDeadlineDialogApp,
    setPendingAcceptApp,
    setAwardBlockReason,
    setW9Context,
    setW9DialogOpen,
    setRespondingHelperAppId,
  } = deps;

  const acceptApplication = async (app: EnrichedApplication) => {
    hapticMedium();
    setDeadlineDialogApp(app);
  };

  /**
   * Poster declines a pending applicant. Marks the application as "rejected"
   * and, when `note` is provided, sends an in-app notification to the helper
   * so they know why.
   */
  const declineApplication = async (
    app: EnrichedApplication,
    note: string,
    jobTitle: string,
  ) => {
    hapticMedium();
    // `.eq("status", "pending")` makes the decline conditional. Without it, a
    // poster with the applicant list open in two tabs could accept in one and
    // decline in the other, leaving the job `accepted` with helper_id set while
    // that same application read `rejected` — two views of one deal disagreeing.
    // A zero-row result now means "already resolved elsewhere", not a failure.
    const { error } = await supabase
      .from("applications")
      .update({ status: "rejected" })
      .eq("id", app.id)
      .eq("status", "pending");
    if (error) {
      hapticError();
      toast.error("Couldn't decline that applicant — please try again.");
      return;
    }
    // Optimistically update the in-memory applications list so the card
    // flips to "Declined" without waiting on a full refresh.
    setApplications((prev) =>
      prev.map((a) => (a.id === app.id ? { ...a, status: "rejected" as const } : a)),
    );
    setInlineApplicants((prev) => {
      const updated: typeof prev = {};
      for (const [jobId, apps] of Object.entries(prev)) {
        updated[jobId] = apps.map((a) =>
          a.id === app.id ? { ...a, status: "rejected" as const } : a,
        );
      }
      return updated;
    });
    if (note.trim()) {
      // Fetch the poster's first name from their profile for the message.
      const posterFirstName = user
        ? await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .single()
            .then(({ data }) => (data?.full_name ?? "").split(" ")[0] || "The poster")
        : "The poster";
      await createNotification({
        user_id: app.helper_id,
        title: "Application declined",
        message: `${posterFirstName} declined your application for "${jobTitle}": ${note.trim()}`,
        type: "info",
      });
    }
  };

  /**
   * Confirms the offer from ResponseDeadlineDialog. Every failure path THROWS
   * an Error carrying the human-readable reason (after rolling back the
   * optimistic patch) — the dialog catches it and renders the message inline,
   * keeping itself open with Send re-enabled. It used to only fire a toast,
   * which is transient and sat BEHIND the open dialog, so a server award-gate
   * refusal looked like the button doing nothing (a poster tapped Send four
   * times against jobs_award_gate with zero visible response).
   */
  const confirmAcceptWithDeadline = async (deadlineHours: number, initialMessage?: string) => {
    if (!deadlineDialogApp || !selectedJob || !user) {
      // This used to `return` silently — the dialog stayed open and Send just
      // did nothing. Report the impossible state and tell the user something.
      report(new Error("confirmAcceptWithDeadline called without app/job/user"), {
        tags: { source: "useOfferHandlers.confirmAcceptWithDeadline" },
        context: {
          hasApp: !!deadlineDialogApp,
          hasJob: !!selectedJob,
          hasUser: !!user,
        },
      });
      throw new Error("Something went wrong preparing this offer — please close and try again.");
    }
    const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
    // Optimistic: move the posted job into the "Awaiting Response" bucket
    // (status accepted, no helper_confirmed_at) right away so the card jumps
    // instead of waiting on the RPC + refetch. Rolled back on any error path.
    // A group job stays 'open' while it is only partially staffed — only the
    // accept that fills the last slot closes it — so don't optimistically show
    // it as accepted. The refetch below settles the real roster state.
    const isGroupJobOptimistic = !!(selectedJob as { is_group_job?: boolean }).is_group_job;
    const snapshot = optimisticallyPatchJob(selectedJob.id, {
      ...(isGroupJobOptimistic ? {} : { status: "accepted" as const }),
      helper_id: deadlineDialogApp.helper_id,
      response_deadline: deadline,
    });
    // Group jobs take a different RPC. accept_application requires the job to
    // be 'open' and immediately flips it to 'accepted', so on a job needing N
    // helpers only the FIRST accept could ever succeed and the roster was never
    // populated. accept_group_application (migration 20260804122000) instead
    // counts the roster inside the job's row lock, inserts the slot, and holds
    // the job 'open' until the final slot is filled.
    const isGroupJob = !!(selectedJob as { is_group_job?: boolean }).is_group_job;
    const { error } = isGroupJob
      ? await supabase.rpc("accept_group_application" as never, {
          p_application_id: deadlineDialogApp.id,
          p_deadline: deadline,
          p_offer_message: initialMessage ?? undefined,
        } as never)
      : await supabase.rpc("accept_application", {
          p_application_id: deadlineDialogApp.id,
          p_deadline: deadline,
          p_offer_message: initialMessage ?? undefined,
        });

    if (error) {
      const msg = String(error?.message ?? "");
      // If the RPC isn't deployed yet (migration not applied to this
      // environment), fall back to a status-guarded direct update so the
      // accept flow still works. `UPDATE jobs ... WHERE status = 'open'`
      // is atomic per row, so a second concurrent accept matches zero
      // rows and is rejected — double-booking is still prevented, just
      // without the RPC's explicit lock. This branch goes dormant the
      // moment the migration lands and the RPC starts succeeding.
      const rpcMissing =
        String(error?.code ?? "") === "PGRST202" ||
        /could not find the function|does not exist|schema cache/i.test(msg);
      // The legacy fallback below is single-helper only: it sets
      // status='accepted' outright, which on a group job would close the
      // posting after ONE slot and strand the remaining helpers. Never run it
      // for a group job — surface the error instead and wait for the migration.
      if (rpcMissing && isGroupJob) {
        rollbackActivity(snapshot);
        hapticError();
        throw new Error("Group job acceptance isn't available yet — please try again shortly.");
      }
      if (rpcMissing) {
        const { data: jobRows, error: jobErr } = await supabase
          .from("jobs")
          .update({ status: "accepted", helper_id: deadlineDialogApp.helper_id, response_deadline: deadline })
          .eq("id", selectedJob.id)
          .eq("status", "open")
          .select("id");
        if (jobErr || !jobRows || jobRows.length === 0) {
          rollbackActivity(snapshot);
          hapticError();
          throw new Error("This job is no longer open — it may already be assigned.");
        }
        // .select("id"): the job row is already flipped to `accepted` by this
        // point. If this second write silently matches nothing the applicant
        // keeps seeing "pending" for a job that is theirs — so treat a zero-row
        // result exactly like an error and roll the whole thing back.
        try {
          unwrapMutation(
            await supabase
              .from("applications")
              .update({ status: "accepted", ...(initialMessage ? { offer_message: initialMessage } : {}) })
              .eq("id", deadlineDialogApp.id)
              .select("id"),
            {
              action: "send this offer",
              context: { applicationId: deadlineDialogApp.id, jobId: selectedJob.id },
            },
          );
        } catch {
          rollbackActivity(snapshot);
          hapticError();
          throw new Error("Couldn't send the offer — please try again.");
        }
      } else {
        rollbackActivity(snapshot);
        hapticError();
        // The server-side acceptance gate (trigger jobs_award_gate) refusing
        // THIS applicant. The poster can do nothing about someone else's Stripe
        // account, so name the situation plainly rather than offering them a
        // fix that isn't theirs to make. The applicant card also carries this
        // as a "Can't be hired yet" chip, so reaching here should be rare.
        const blocked = awardBlockFromError(error);
        if (blocked) {
          throw new Error(
            posterAwardBlockMessage(
              blocked,
              deadlineDialogApp.profiles?.full_name ?? undefined,
            ),
          );
        }
        throw new Error(
          msg.includes("job_not_open")
            ? "This job is no longer open — it may already be assigned."
            : msg.includes("application_not_found")
              ? "This application no longer exists — the applicant may have withdrawn."
              : msg.includes("application_not_pending")
                ? "This applicant can no longer be accepted."
                : msg.includes("not_authorized")
                  ? "You can only accept applicants on a job you posted."
                  : "Couldn't send the offer — please try again.",
        );
      }
    }
    await createNotification({ user_id: deadlineDialogApp.helper_id, title: "📋 New job offer!", message: `You've been selected for "${selectedJob.title}". Respond within ${deadlineHours} hour${deadlineHours > 1 ? "s" : ""} or the offer expires.`, type: "info", link: "/my-jobs?filter=offered" });
    // Success moment — the poster just hired an applicant. hapticSuccess is
    // a result haptic (fires even under Reduce Motion); the overlay itself
    // self-respects reduced motion (static check, no draw-in).
    hapticSuccess();
    fireSuccessMoment({ label: "Applicant hired" });
    setDeadlineDialogApp(null);
    setSelectedJob(null);
    setApplications([]);
    setInlineApplicants(prev => { const copy = { ...prev }; delete copy[selectedJob.id]; return copy; });
    await refresh();
    setStatusFilter("offered");
  };

  /**
   * A direct offer has no `applications` row — the poster stamps the offer on
   * the JOB and useActivityData fabricates a card row with `id =
   * "direct-<jobId>"`. Every application-keyed RPC below would receive that
   * string where a uuid is expected and fail with 22P02, so this path is
   * routed to the job-keyed `respond_to_direct_offer` RPC instead.
   */
  const isSyntheticDirectOffer = (app: Application) => app.id.startsWith("direct-");

  const respondToDirectOffer = async (app: Application, accept: boolean) => {
    if (accept) {
      // The same gate as an application accept — a helper Stripe can't pay, or
      // hasn't finished identifying, must not be able to take a job, whichever
      // door they came through.
      const gate = await checkHelperAwardEligibility();
      if (gate.indeterminate) {
        // "We couldn't ask" is not "you're not verified". Saying the second
        // when we only know the first is what used to trap a verified helper.
        hapticError();
        toast.error("Couldn't check your verification status — please try again.");
        return;
      }
      if (!gate.ok && gate.reason) {
        setPendingAcceptApp(app);
        setAwardBlockReason(gate.reason);
        return;
      }
    }

    // Shipped by migration 20260820000000; the generated Supabase types are
    // regenerated separately, so the call is narrowed by hand rather than
    // waiting on that (same pattern as `applyToJobRpc` in useApplyFlow).
    const respondRpc = supabase.rpc.bind(supabase) as unknown as (
      fn: "respond_to_direct_offer",
      args: { p_job_id: string; p_accept: boolean },
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    const { error } = await respondRpc("respond_to_direct_offer", {
      p_job_id: app.job_id,
      p_accept: accept,
    });

    if (error) {
      hapticError();
      const code = String((error as { code?: string }).code ?? "");
      const msg = String(error.message ?? "");
      if (code === "PGRST202") {
        // Merge landed, migration hasn't deployed yet (db-deploy.yml runs on
        // the merge commit). Say so instead of blaming the user's tap.
        toast.error("Offer responses are updating right now — try again in a minute.");
        return;
      }
      // The RPC's guards, in the helper's language. Each one means the offer
      // moved out from under this card, so re-read rather than leave the same
      // two buttons sitting there to fail again.
      const guard =
        /offer_expired/.test(msg) ? "This offer expired — the job is open to everyone again."
        : /offer_not_pending|not_your_offer/.test(msg) ? "This offer isn't yours to respond to any more."
        : /job_not_open/.test(msg) ? "This job is no longer open."
        : /job_not_found/.test(msg) ? "This job is no longer available."
        : null;
      if (guard) {
        toast.error(guard);
        await refresh();
        return;
      }
      const blocked = awardBlockFromError(error);
      if (blocked) {
        setPendingAcceptApp(app);
        setAwardBlockReason(blocked);
        return;
      }
      report(error, { tags: { source: "useOfferHandlers.respondToDirectOffer" } });
      toast.error("Couldn't record your response — please try again.");
      return;
    }

    hapticSuccess();
    if (accept) {
      fireSuccessMoment({ label: "Job accepted" });
      await refresh();
      setStatusFilter("accepted");
    } else {
      await refresh();
    }
  };

  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    setRespondingHelperAppId(app.id);
    try {
    if (isSyntheticDirectOffer(app)) {
      await respondToDirectOffer(app, accept);
      return;
    }
    if (accept) {
      // The acceptance gate: payout-ready AND identity verified by Stripe.
      // A blocked accept has to carry its own way out — never a refusal with
      // nowhere to go — so the failure opens AwardGateDialog, which names the
      // missing half and links into the right Stripe flow for it.
      const gate = await checkHelperAwardEligibility();
      if (gate.indeterminate) {
        // On a dropped check `ok` is false but we know nothing. That used to
        // read as "not verified" and trapped an already-verified helper in the
        // IDV dialog with no way out. Say what actually happened.
        hapticError();
        toast.error("Couldn't check your verification status — please try again.");
        return;
      }
      if (!gate.ok && gate.reason) {
        setPendingAcceptApp(app);
        setAwardBlockReason(gate.reason);
        return;
      }

      // Optimistic: move this applied job from the "Awaiting Response"
      // bucket into "Accepted" instantly (helper_confirmed_at set, deadline
      // cleared) so the card transitions on tap, not after the refetch.
      const confirmedAt = new Date().toISOString();
      const snapshot = optimisticallyPatchJob(app.job_id, {
        helper_confirmed_at: confirmedAt,
        response_deadline: null,
      });
      // Make the confirm CONDITIONAL so it can't race the expiry cron or
      // double-fire. Previously it re-checked nothing, so a helper could
      // confirm an offer that had already lapsed (or confirm twice).
      //   - `helper_confirmed_at is null` → blocks a second confirm.
      //   - deadline null OR still in the future → blocks confirming a lapsed
      //     offer. The null branch matters: not every offer carries a deadline,
      //     and a bare `.gt()` would silently exclude those legitimate rows.
      // `.select("id")` lets us tell "updated nothing" from "errored".
      const { data: confirmedRows, error: confirmError } = await supabase
        .from("jobs")
        .update({ helper_confirmed_at: confirmedAt, response_deadline: null })
        .eq("id", app.job_id)
        .is("helper_confirmed_at", null)
        .or(`response_deadline.is.null,response_deadline.gt.${confirmedAt}`)
        .select("id");
      if (confirmError) {
        rollbackActivity(snapshot);
        hapticError();
        // The server gate can still refuse here even though we checked above —
        // the Stripe state may have moved between the check and the write, and
        // the trigger is the authority. Show the same explained blocked state
        // rather than a generic failure the helper can't act on.
        const blocked = awardBlockFromError(confirmError);
        if (blocked) {
          setPendingAcceptApp(app);
          setAwardBlockReason(blocked);
          return;
        }
        toast.error("Couldn't accept the job — please try again.");
        return;
      }
      if (!confirmedRows || confirmedRows.length === 0) {
        // Zero rows = the offer lapsed or was already confirmed elsewhere.
        // Roll the optimistic patch back rather than leaving the card showing
        // an acceptance that never happened.
        rollbackActivity(snapshot);
        hapticError();
        toast.error("This offer is no longer available — it may have expired.");
        // Same reasoning as the decline path below: re-read rather than leave
        // the card offering an action that just bounced.
        await refresh();
        return;
      }
      // Helper-side reject of the losing applicants. The direct UPDATE this
      // used to issue was RLS-filtered to zero rows (applications.UPDATE only
      // permits the customer), so other applicants got stuck in "pending"
      // forever. Goes through a SECURITY DEFINER RPC that re-validates the
      // caller is the accepted helper. PGRST202 fallback covers the window
      // between merge and the manual `supabase db push` to prod.
      const { error: rejectErr } = await supabase.rpc("reject_other_applications_on_accept", {
        p_job_id: app.job_id,
        p_accepted_application_id: app.id,
      });
      if (rejectErr && rejectErr.code !== "PGRST202") {
        console.warn("Failed to auto-reject other applications", rejectErr);
      }

      // W-9 collection — if the business poster set requires_w9 = true,
      // the helper signs immediately at acceptance. The column may not
      // exist yet (PGRST204) on prod between merge and `supabase db push`;
      // in that case we skip silently.
      try {
        // `requires_w9` is a new column not in the generated types yet, so
        // the builder is cast to a minimal shape returning the row we read.
        // The cast MUST include `error`. Omitting it made a genuine read failure
        // indistinguishable from `requires_w9: false`, so the W-9 signature
        // dialog was silently skipped on a business job that legally requires
        // one — a compliance gap that looked identical to the happy path.
        const { data: jobMeta, error: jobMetaError } = await (supabase.from("jobs") as unknown as {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{
                data: { requires_w9?: boolean | null; business_id?: string | null } | null;
                error: { code?: string; message: string } | null;
              }>;
            };
          };
        })
          .select("requires_w9, business_id")
          .eq("id", app.job_id)
          .maybeSingle();
        // Rethrow into the catch below so a real failure is REPORTED rather
        // than silently treated as "no W-9 needed". PGRST204/42703 (column not
        // on prod yet) is still handled there as the intended graceful skip.
        if (jobMetaError) throw jobMetaError;
        if (jobMeta && jobMeta.requires_w9) {
          setW9Context({ jobId: app.job_id, businessId: jobMeta.business_id ?? null });
          setW9DialogOpen(true);
        }
      } catch (err) {
        // requires_w9 column missing on pre-migration prod → skip is the
        // intended graceful degrade. Any other unexpected error still gets
        // reported so we can see it in monitoring rather than dropping it
        // into the same silent bucket.
        const code = (err as { code?: string })?.code;
        if (code !== "PGRST204" && code !== "42703") {
          report(err, { tags: { source: "useOfferHandlers.w9Fetch" }, context: { job_id: app.job_id } });
        }
      }

      hapticSuccess();
      // Funnel: helper accepted an offer — closes the "applied → hired" gap
      // in the helper funnel that previously had zero instrumentation.
      const ppoProps = ppoTrackingProps();
      track(AhaEvent.JobAccepted, { job_id: app.job_id, ...ppoProps });
      // First-acceptance aha — count prior confirmed acceptances by this
      // helper (helper_confirmed_at != null). ≤ 1 covers the row we just
      // wrote since the count read may race the just-written update.
      try {
        const { count } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("helper_id", user.id)
          .not("helper_confirmed_at", "is", null);
        if ((count ?? 0) <= 1) {
          track(AhaEvent.FirstJobAccepted, { job_id: app.job_id, ...ppoProps });
          // First-acceptance push nudge — best moment to ask a helper to
          // turn on notifications: they now care about new-job pings and
          // customer messages on this job. The hook self-suppresses if
          // permission is already granted or the user dismissed recently.
          void triggerPushNudge("helper-first-accept");
        }
      } catch { /* analytics must never break the flow */ }
      await refresh();
      setStatusFilter("accepted");
    } else {
      // Decline — atomic via the decline_job_offer RPC: the violation
      // insert, ladder escalation (apply_job_denial_consequence, migration
      // 20260824243000), app rejection and job reopen all run in one
      // transaction. If the RPC isn't deployed yet the decline fails CLOSED
      // (see below) — there is deliberately no client-side re-implementation
      // of the consequence ladder.
      let actionTaken: string;
      let priorCount: number;

      const { data: rpcData, error: rpcError } = await supabase.rpc("decline_job_offer", {
        p_application_id: app.id,
      });

      if (rpcError) {
        const msg = String(rpcError?.message ?? "");
        const rpcMissing =
          String(rpcError?.code ?? "") === "PGRST202" ||
          /could not find the function|does not exist|schema cache/i.test(msg);
        if (!rpcMissing) {
          hapticError();
          if (/offer_not_active/.test(msg)) {
            // The RPC's guard is `jobs.helper_id = auth.uid()`. This card is
            // shown whenever the APPLICATION says accepted, which is a
            // different fact — the two can disagree (a reopened job, a poster
            // who reassigned, a partially-staffed group roster), and when they
            // do the helper taps a button the server was always going to
            // refuse. The old copy just said "no longer active" and left the
            // card sitting there with the same two dead buttons.
            //
            // Refresh so the card re-renders from the truth instead of
            // repeating the failure.
            toast.error("This job isn't yours to respond to any more — someone else may have been booked.");
            await refresh();
            return;
          }
          toast.error("Couldn't record your response — please try again.");
          return;
        }
        // RPC missing (the merge → db-deploy window). The old fallback
        // re-implemented the RETIRED 5-strike ladder client-side (warning at
        // the 3rd, permanent at the 5th, no temp ban at all), so a helper who
        // declined during a deploy window was graded against rules the
        // backend no longer has. The consequence ladder is moderation logic —
        // it runs in one place, in the RPC's transaction, or not at all.
        // Fail closed like the group-accept fallback: record nothing locally
        // and ask for a retry once the migration lands.
        report(rpcError, { tags: { source: "useOfferHandlers.declineRpcMissing" } });
        hapticError();
        toast.error("We couldn't record this right now — try again shortly.");
        return;
      } else {
        // RPC returns a Json blob (type is `Json` per generated types), so
        // narrow it to the record shape we know it emits before reading.
        const rpcResult = (rpcData ?? {}) as { action?: string; prior_count?: number };
        actionTaken = rpcResult.action ?? "none";
        priorCount = rpcResult.prior_count ?? 0;
      }

      // Consequence surfacing — the RPC's action, said in the ladder's real
      // terms. The RPC already inserts the helper's in-app notification for a
      // warning, so no client createNotification here (it used to double up —
      // two notifications for one strike, quoting the retired 5-strike math).
      if (actionTaken === "warning") {
        // Action "warning" is the SECOND strike: the final warning.
        toast.warning("This is your final warning — one more strike suspends your account for 7 days.");
      } else if (actionTaken === "temp_ban") {
        hapticError();
        // Third strike: 7-day suspension. The toast states it, but the banned
        // screen is the real surface — same hard document load as the
        // permanent path below, so no suspended session stays live in memory
        // (/account-banned reads ban_status/auto_suspended_until and renders
        // the temporary variant with the return date).
        toast.warning("Third strike — your account is suspended for 7 days.");
        window.location.assign("/account-banned");
      } else if (actionTaken === "pending_ban_review" || actionTaken === "permanent_ban") {
        hapticError();
        // Fourth strike. As of 20260829010000 this comes back as
        // `pending_ban_review` — a REVERSIBLE 7-day restriction while an admin
        // decides, matching the message and cancellation ladders. The retired
        // "permanent_ban" string is still handled because there is a window
        // between this code shipping and the migration landing on prod.
        //
        // Same reasoning as CancellationDialog either way: this is not a toast.
        // Send them to the banned screen, which reads ban_status off the
        // profile and states the rule, the reason and the support path — and
        // does not auto-dismiss.
        //
        // window.location, not useNavigate: createOfferHandlers is a plain
        // factory function, not a React hook, so hooks cannot be called here.
        // A full document load is also the RIGHT behaviour for a ban — it tears
        // down all cached authed state rather than leaving a banned session
        // live in memory behind the screen.
        window.location.assign("/account-banned");
      }
      if (actionTaken !== "none") {
        // Admin fan-out — a silent drop here means no admin sees the
        // decline notification. Warn-report but continue (the DB action
        // already committed, the user's toast still fires).
        const { data: adminRoles, error: adminRolesErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRolesErr) {
          report(adminRolesErr, { severity: "warning", tags: { source: "useOfferHandlers.declineAdminFanout" } });
        }
        for (const admin of adminRoles ?? []) {
          await createNotification({ user_id: admin.user_id, title: "⚠️ Helpr declined job offer", message: `Helpr declined offer (${priorCount + 1} total). Action: ${actionTaken}.`, type: "warning", link: "/admin" });
        }
      }
      refresh();
    }
    } finally {
      setRespondingHelperAppId(null);
    }
  };

  return {
    acceptApplication,
    declineApplication,
    confirmAcceptWithDeadline,
    handleHelperResponse,
  };
}
