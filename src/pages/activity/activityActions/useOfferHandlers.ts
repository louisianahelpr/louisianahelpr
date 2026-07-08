import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { fireSuccessMoment } from "@/lib/successMoment";
import type { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import type { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import type { User as SupaUser } from "@supabase/supabase-js";
import type {
  Job,
  Application,
  EnrichedApplication,
  AppliedApp,
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
  checkHelperStripeConnect: ReturnType<typeof useStripeConnectCheck>["checkHelperStripeConnect"];
  triggerPushNudge: ReturnType<typeof usePushPermissionNudge>;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  setApplications: React.Dispatch<React.SetStateAction<EnrichedApplication[]>>;
  setInlineApplicants: React.Dispatch<React.SetStateAction<Record<string, EnrichedApplication[]>>>;
  deadlineDialogApp: EnrichedApplication | null;
  setDeadlineDialogApp: (app: EnrichedApplication | null) => void;
  setPendingAcceptApp: (app: Application | null) => void;
  setIdvStatus: (status: string | undefined) => void;
  setIdvFailureReason: (reason: string | undefined) => void;
  setIdvDialogOpen: (open: boolean) => void;
  setW9Context: (ctx: { jobId: string; businessId: string | null } | null) => void;
  setW9DialogOpen: (open: boolean) => void;
  setRespondingHelperAppId: (id: string | null) => void;
}

export function createOfferHandlers(deps: OfferHandlersDeps) {
  const {
    user,
    refresh,
    setStatusFilter,
    checkHelperStripeConnect,
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
    setIdvStatus,
    setIdvFailureReason,
    setIdvDialogOpen,
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
    const { error } = await supabase
      .from("applications")
      .update({ status: "rejected" })
      .eq("id", app.id);
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
    toast.info("Applicant declined.");
  };

  const confirmAcceptWithDeadline = async (deadlineHours: number, initialMessage?: string) => {
    if (!deadlineDialogApp || !selectedJob || !user) return;
    const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();
    // Optimistic: move the posted job into the "Awaiting Response" bucket
    // (status accepted, no helper_confirmed_at) right away so the card jumps
    // instead of waiting on the RPC + refetch. Rolled back on any error path.
    const snapshot = optimisticallyPatchJob(selectedJob.id, {
      status: "accepted",
      helper_id: deadlineDialogApp.helper_id,
      response_deadline: deadline,
    });
    // Atomic accept via the accept_application RPC (migration
    // 20260518120000): it row-locks the job so two concurrent accepts
    // can't both book the same single-helper job.
    const { error } = await supabase.rpc("accept_application", {
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
          toast.error("This job is no longer open — it may already be assigned.");
          return;
        }
        const { error: appErr } = await supabase
          .from("applications")
          .update({ status: "accepted", ...(initialMessage ? { offer_message: initialMessage } : {}) })
          .eq("id", deadlineDialogApp.id);
        if (appErr) {
          rollbackActivity(snapshot);
          hapticError();
          toast.error("Couldn't send the offer — please try again.");
          return;
        }
      } else {
        rollbackActivity(snapshot);
        hapticError();
        toast.error(
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
        return;
      }
    }
    await createNotification({ user_id: deadlineDialogApp.helper_id, title: "📋 New job offer!", message: `You've been selected for "${selectedJob.title}". Respond within ${deadlineHours} hour${deadlineHours > 1 ? "s" : ""} or the offer expires.`, type: "info", link: "/my-jobs?filter=offered" });
    // Success moment — the poster just hired an applicant. hapticSuccess is
    // a result haptic (fires even under Reduce Motion); the overlay itself
    // self-respects reduced motion (static check, no draw-in).
    hapticSuccess();
    fireSuccessMoment({ label: "Applicant hired" });
    toast.success(`Offer sent! Helpr has ${deadlineHours}h to respond.`);
    setDeadlineDialogApp(null);
    setSelectedJob(null);
    setApplications([]);
    setInlineApplicants(prev => { const copy = { ...prev }; delete copy[selectedJob.id]; return copy; });
    await refresh();
    setStatusFilter("offered");
  };

  const handleHelperResponse = async (app: Application, accept: boolean) => {
    if (!user) return;
    setRespondingHelperAppId(app.id);
    try {
    if (accept) {
      const stripeCheck = await checkHelperStripeConnect();
      if (!stripeCheck.ok) { hapticError(); toast.error(stripeCheck.reason); return; }

      // Identity verification gate — required before first accept. On a
      // transient fetch failure, `prof` is undefined and reads as
      // "not verified" — which used to look identical to a truly
      // unverified user and trapped an already-verified helper in the
      // IDV dialog. Surface the error explicitly instead.
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("idv_status, idv_failure_reason")
        .eq("user_id", user.id)
        .single();
      if (profErr) {
        report(profErr, { tags: { source: "useOfferHandlers.idvGate" } });
        hapticError();
        toast.error("Couldn't check your verification status — please try again.");
        return;
      }
      const profIdvStatus = (prof as { idv_status?: string })?.idv_status;
      if (profIdvStatus !== "verified") {
        setPendingAcceptApp(app);
        setIdvStatus(profIdvStatus);
        setIdvFailureReason((prof as { idv_failure_reason?: string })?.idv_failure_reason);
        setIdvDialogOpen(true);
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
      const { error: confirmError } = await supabase
        .from("jobs")
        .update({ helper_confirmed_at: confirmedAt, response_deadline: null })
        .eq("id", app.job_id);
      if (confirmError) {
        rollbackActivity(snapshot);
        hapticError();
        toast.error("Couldn't accept the job — please try again.");
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
        const { data: jobMeta } = await (supabase.from("jobs") as unknown as {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{
                data: { requires_w9?: boolean | null; business_id?: string | null } | null;
              }>;
            };
          };
        })
          .select("requires_w9, business_id")
          .eq("id", app.job_id)
          .maybeSingle();
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
      toast.success("Job accepted! You can start when ready or it will auto-start on the scheduled date.");
      await refresh();
      setStatusFilter("accepted");
    } else {
      // Decline — atomic via the decline_job_offer RPC (migration
      // 20260518140000): the violation insert, ban escalation, app
      // rejection and job reopen all run in one transaction. Falls back
      // to the pre-migration multi-step path (atomic per-row only) if
      // the RPC isn't deployed to this environment yet — that branch
      // goes dormant once the migration lands.
      let actionTaken: string;
      let priorCount: number;
      const declineTitle = (app as AppliedApp).job?.title || "Unknown";

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
          toast.error(
            /offer_not_active/.test(msg)
              ? "This offer is no longer active."
              : "Couldn't record your response — please try again.",
          );
          return;
        }
        // Prior violation count drives the graduated-ban ladder — a dropped
        // error here would reset priorCount to 0 and let a repeat offender
        // evade escalation to a warning or ban. Fail closed: abort the
        // decline attempt so they retry rather than silently getting off.
        const { data: existing, error: violErr } = await supabase.from("user_violations").select("id").eq("user_id", user.id).eq("violation_type", "job_denial");
        if (violErr) {
          report(violErr, { tags: { source: "useOfferHandlers.priorViolationCount" } });
          hapticError();
          toast.error("Couldn't record your response right now — please try again.");
          return;
        }
        priorCount = existing?.length || 0;
        // Softened: 5 strikes with graduated warnings before ban
        actionTaken = priorCount >= 4 ? "permanent_ban" : priorCount >= 2 ? "warning" : "none";
        // Fallback path (RPC missing) — every write below was previously
        // fire-and-forget. That's a moderation silent-failure surface: a
        // failed insert/update leaves the offender uncounted, unbanned, or
        // the job un-reopened without any signal. Cowork audit 2026-07-08.
        // Best-effort with logging — this branch only runs when the RPC
        // isn't deployed, so we log rather than abort (aborting mid-way
        // through leaves partial state, which is worse than a logged nudge).
        const logIfErr = (label: string) => (result: { error: unknown }) => {
          if (result?.error) {
            report(result.error, { tags: { source: `useOfferHandlers.declineFallback.${label}` } });
          }
        };
        await supabase.from("user_violations").insert({ user_id: user.id, violation_type: "job_denial", description: `Declined job offer: "${declineTitle}"`, job_id: app.job_id, action_taken: actionTaken }).then(logIfErr("insertViolation"));
        if (actionTaken === "warning") {
          await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", user.id).then(logIfErr("warnUpdate"));
        } else if (actionTaken === "permanent_ban") {
          await supabase.from("user_bans").insert({ user_id: user.id, ban_type: "permanent", reason: "Declined 5 job offers after being selected", banned_by: user.id }).then(logIfErr("banInsert"));
          await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", user.id).then(logIfErr("banUpdate"));
        }
        await supabase.from("applications").update({ status: "rejected" }).eq("id", app.id).then(logIfErr("rejectApp"));
        await supabase.from("jobs").update({ status: "open", helper_id: null, response_deadline: null }).eq("id", app.job_id).then(logIfErr("reopenJob"));
      } else {
        // RPC returns a Json blob (type is `Json` per generated types), so
        // narrow it to the record shape we know it emits before reading.
        const rpcResult = (rpcData ?? {}) as { action?: string; prior_count?: number };
        actionTaken = rpcResult.action ?? "none";
        priorCount = rpcResult.prior_count ?? 0;
      }

      // Notifications (best-effort) + toasts — shared by both paths.
      if (actionTaken === "warning") {
        const warningNum = priorCount + 1;
        await createNotification({ user_id: user.id, title: `⚠️ Decline Warning (${warningNum}/4)`, message: `You've declined ${warningNum} job offer${warningNum > 1 ? "s" : ""}. Declining ${5 - warningNum} more will result in a permanent ban.`, type: "warning", link: "/profile" });
        toast.warning(`Warning ${warningNum}/4: You've declined a job offer.`);
      } else if (actionTaken === "permanent_ban") {
        hapticError();
        toast.error("Your account has been permanently banned due to repeated job offer declines.");
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
      toast.info("You declined the job. The poster can select someone else.");
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
