import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { checkProximity } from "@/lib/locationUtils";
import { aggregateRatings } from "@/lib/reviewStats";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { fetchProfile } from "@/hooks/useProfile";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import { queryKeys } from "@/lib/queryKeys";
import type { ActivityData } from "@/hooks/useActivityData";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import type {
  Job,
  Application,
  EnrichedApplication,
  AppliedApp,
} from "@/components/activity/activityConstants";

/**
 * useActivityActions — data-loading + all action handlers for the Activity
 * page (accept / decline / complete / no-show / start / arrival / etc.),
 * plus the dialog and per-action UI state those handlers own.
 *
 * Handlers call `setStatusFilter` to jump the filter after a state
 * transition, and `refresh` (from useActivityData) to reconcile the cache.
 */
export interface UseActivityActionsArgs {
  user: SupaUser | null;
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  refresh: () => void | Promise<unknown>;
  setStatusFilter: (filter: string) => void;
  helperNames?: Record<string, string>;
  completedJobMeta?: Record<string, { tipped: boolean; reviewed: boolean }>;
}

export function useActivityActions({
  user,
  postedJobs,
  appliedApps,
  refresh,
  setStatusFilter,
  helperNames = {},
  completedJobMeta = {},
}: UseActivityActionsArgs) {
  const queryClient = useQueryClient();
  const { checkHelperStripeConnect } = useStripeConnectCheck();
  const triggerPushNudge = usePushPermissionNudge();

  // UI state
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [reportingNoShow, setReportingNoShow] = useState(false);

  // Dialog state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState(false);
  const [inlineApplicants, setInlineApplicants] = useState<Record<string, EnrichedApplication[]>>({});
  const [loadingApplicants, setLoadingApplicants] = useState<Record<string, boolean>>({});
  const [applicantErrors, setApplicantErrors] = useState<Record<string, boolean>>({});
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [boostJobId, setBoostJobId] = useState<string | null>(null);
  const [enhancedTipJobId, setEnhancedTipJobId] = useState<string | null>(null);
  const [enhancedTipHelperName, setEnhancedTipHelperName] = useState("");
  const [noShowJobId, setNoShowJobId] = useState<string | null>(null);
  const [cancelDialogJob, setCancelDialogJob] = useState<Job | null>(null);
  const [revisionJobId, setRevisionJobId] = useState<string | null>(null);
  const [deadlineDialogApp, setDeadlineDialogApp] = useState<(Application & { profiles?: any }) | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<{ job: Job; revieweeId: string; revieweeName: string } | null>(null);
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);
  // Read-only timeline + follow-up evidence for an already-disputed
  // job. Separate from disputeJob so the file-a-new-dispute and
  // view-the-existing-one dialogs don't collide on the same state.
  const [viewDisputeJob, setViewDisputeJob] = useState<Job | null>(null);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [helperReviewJob, setHelperReviewJob] = useState<{ jobId: string; posterId: string; posterName: string } | null>(null);

  const [idvDialogOpen, setIdvDialogOpen] = useState(false);
  const [idvStatus, setIdvStatus] = useState<string | undefined>(undefined);
  const [idvFailureReason, setIdvFailureReason] = useState<string | undefined>(undefined);
  const [pendingAcceptApp, setPendingAcceptApp] = useState<Application | null>(null);

  // W-9 e-sign — surfaces when the accepted job has `requires_w9 = true`
  // (set by business posters at post time). We open the dialog after the
  // optimistic acceptance lands.
  const [w9DialogOpen, setW9DialogOpen] = useState(false);
  const [w9Context, setW9Context] = useState<{ jobId: string; businessId: string | null } | null>(null);

  // --- Optimistic cache helper ---
  // Money-path handlers below patch the cached ActivityData *before* the
  // Supabase write lands so the card moves to its new state instantly. The
  // helper patches every place a job appears in the cache (the poster's
  // `postedJobs` row and any `appliedApps[].job` that references it), returns
  // a snapshot for rollback, and skips entirely if the cache is empty (the
  // write still runs — it just isn't optimistic). On error the caller restores
  // the snapshot; on success refresh()/realtime reconciles authoritative state.
  const optimisticallyPatchJob = useCallback(
    (jobId: string, patch: Partial<Job>): ActivityData | undefined => {
      if (!user) return undefined;
      const key = queryKeys.activity.byUser(user.id);
      const snapshot = queryClient.getQueryData<ActivityData>(key);
      if (!snapshot) return undefined;
      queryClient.setQueryData<ActivityData>(key, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          postedJobs: prev.postedJobs.map((j) =>
            j.id === jobId ? { ...j, ...patch } : j,
          ),
          appliedApps: prev.appliedApps.map((a) =>
            a.job_id === jobId && a.job
              ? { ...a, job: { ...a.job, ...patch } }
              : a,
          ),
        };
      });
      return snapshot;
    },
    [user, queryClient],
  );

  // Restore a snapshot taken before an optimistic patch (rollback on error).
  const rollbackActivity = useCallback(
    (snapshot: ActivityData | undefined) => {
      if (!user || !snapshot) return;
      queryClient.setQueryData<ActivityData>(queryKeys.activity.byUser(user.id), snapshot);
    },
    [user, queryClient],
  );

  // --- Action handlers ---

  const fetchApplicants = async (jobId: string): Promise<EnrichedApplication[]> => {
    const { data: apps, error: appsError } = await supabase.from("applications").select("*").eq("job_id", jobId);
    if (appsError) throw appsError;
    if (apps && apps.length > 0) {
      // Filter out applicants the current user has blocked (or who blocked them)
      const { getBlockedUserIds } = await import("@/lib/userBlocks");
      const blockedSet = user ? await getBlockedUserIds(user.id) : new Set<string>();
      const visibleApps = apps.filter((a: any) => !blockedSet.has(a.helper_id));
      if (visibleApps.length === 0) return [];

      const helperIds = visibleApps.map((a) => a.helper_id);
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: helperIds }),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", helperIds).lte("feedback_visible_at", new Date().toISOString()),
      ]);
      const reviewStatsMap = aggregateRatings(reviewsRes.data);
      const enriched = visibleApps.map((app) => {
        const prof = profilesRes.data?.find((p) => p.user_id === app.helper_id) || null;
        const stats = reviewStatsMap.get(app.helper_id);
        return { ...app, profiles: prof, reviewCount: stats?.count ?? 0, avgRating: stats?.avg ?? 0 };
      });
      // Boosted Visibility: Pro/Elite helpers appear first in applicant lists
      const tierOrder = (tier: string | null | undefined) => tier === "elite" ? 3 : tier === "pro" ? 2 : tier === "basic" ? 1 : 0;
      enriched.sort((a, b) => tierOrder(a.profiles?.subscription_tier) - tierOrder(b.profiles?.subscription_tier));
      enriched.reverse();
      return enriched;
    }
    return [];
  };

  const loadApplications = async (job: Job) => {
    setSelectedJob(job);
    setApplicationsLoading(true);
    setApplicationsError(false);
    setApplications([]);
    try {
      const enriched = await fetchApplicants(job.id);
      setApplications(enriched);
    } catch {
      // A failed fetch must not read as "no applicants" — tell the truth.
      setApplicationsError(true);
      hapticError();
      toast.error("Couldn't pull up applicants right now — give it a second and try again?");
    } finally {
      setApplicationsLoading(false);
    }
  };

  const loadInlineApplicants = useCallback(async (jobId: string) => {
    // Clear any prior error and start loading (supports retry by always re-fetching).
    setApplicantErrors(prev => ({ ...prev, [jobId]: false }));
    setLoadingApplicants(prev => ({ ...prev, [jobId]: true }));
    try {
      const enriched = await fetchApplicants(jobId);
      setInlineApplicants(prev => ({ ...prev, [jobId]: enriched }));
    } catch {
      setApplicantErrors(prev => ({ ...prev, [jobId]: true }));
      hapticError();
      toast.error("Couldn't pull up applicants right now — give it a second and try again?");
    } finally {
      setLoadingApplicants(prev => ({ ...prev, [jobId]: false }));
    }
  }, [user]);

  const acceptApplication = async (app: EnrichedApplication) => {
    hapticMedium();
    setDeadlineDialogApp(app);
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
      p_offer_message: initialMessage ?? null,
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
    if (accept) {
      const stripeCheck = await checkHelperStripeConnect();
      if (!stripeCheck.ok) { hapticError(); toast.error(stripeCheck.reason); return; }

      // Identity verification gate — required before first accept
      const { data: prof } = await supabase
        .from("profiles")
        .select("idv_status, idv_failure_reason")
        .eq("user_id", user.id)
        .single();
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
        const { data: jobMeta } = await (supabase.from as any)("jobs")
          .select("requires_w9, business_id")
          .eq("id", app.job_id)
          .maybeSingle();
        if (jobMeta && (jobMeta as any).requires_w9) {
          setW9Context({ jobId: app.job_id, businessId: (jobMeta as any).business_id ?? null });
          setW9DialogOpen(true);
        }
      } catch {
        // requires_w9 column missing → migration not yet applied. Skip.
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
        const { data: existing } = await supabase.from("user_violations").select("id").eq("user_id", user.id).eq("violation_type", "job_denial");
        priorCount = existing?.length || 0;
        // Softened: 5 strikes with graduated warnings before ban
        actionTaken = priorCount >= 4 ? "permanent_ban" : priorCount >= 2 ? "warning" : "none";
        await supabase.from("user_violations").insert({ user_id: user.id, violation_type: "job_denial", description: `Declined job offer: "${declineTitle}"`, job_id: app.job_id, action_taken: actionTaken });
        if (actionTaken === "warning") {
          await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", user.id);
        } else if (actionTaken === "permanent_ban") {
          await supabase.from("user_bans").insert({ user_id: user.id, ban_type: "permanent", reason: "Declined 5 job offers after being selected", banned_by: user.id });
          await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", user.id);
        }
        await supabase.from("applications").update({ status: "rejected" }).eq("id", app.id);
        await supabase.from("jobs").update({ status: "open", helper_id: null, response_deadline: null }).eq("id", app.job_id);
      } else {
        actionTaken = (rpcData?.action as string) ?? "none";
        priorCount = (rpcData?.prior_count as number) ?? 0;
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
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        for (const admin of adminRoles ?? []) {
          await createNotification({ user_id: admin.user_id, title: "⚠️ Helpr declined job offer", message: `Helpr declined offer (${priorCount + 1} total). Action: ${actionTaken}.`, type: "warning", link: "/admin" });
        }
      }
      toast.info("You declined the job. The poster can select someone else.");
      refresh();
    }
  };

  const tryCancelJob = async (job: Job) => {
    const { data: tracking } = await supabase.from("job_tracking").select("status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1);
    const trackingStatus = tracking?.[0]?.status;
    if (trackingStatus && ["on_the_way", "arrived", "working", "done"].includes(trackingStatus)) {
      hapticError();
      toast.error("This job can't be cancelled — the helpr is already on the way or working.", { duration: 5000 });
      return;
    }
    setCancelDialogJob(job);
  };

  const completeJob = async (jobId: string) => {
    setCompletingJobId(jobId);
    try {
      const isHelper = appliedApps.some(a => a.job_id === jobId && a.helper_id === user?.id);
      if (isHelper) {
        const job = appliedApps.find(a => a.job_id === jobId)?.job;
        if (job) {
          // GPS proximity check with photo fallback
          const proximity = await checkProximity(job.latitude, job.longitude);
          if (!proximity.allowed) {
            // Check if helper has a verified arrival check-in (GPS or photo fallback)
            const { data: arrivalCheckins } = await supabase
              .from("job_checkins")
              .select("id")
              .eq("job_id", jobId)
              .eq("user_id", user!.id)
              .in("type", ["arrival", "arrival_photo"])
              .limit(1);

            if (!arrivalCheckins?.length) {
              const miles = ((proximity.distance || 0) / 5280).toFixed(1);
              hapticError();
              toast.error(
                `You need to be within 500ft of the job site (or have a verified arrival check-in) to wrap up. You're about ${miles} miles away — if your GPS is off, use "Check In with Photo" instead.`,
                { duration: 8000 }
              );
              return;
            }
          }

          // Require after-photos for jobs $50+
          if (job.budget >= 50) {
            const { data: jobData } = await supabase
              .from("jobs")
              .select("proof_after_urls")
              .eq("id", jobId)
              .single();
            const afterPhotos = jobData?.proof_after_urls || [];
            if (afterPhotos.length === 0) {
              hapticError();
              toast.error("Add an after-photo before you mark a $50+ job complete.", { duration: 6000 });
              return;
            }
          }
        }
      }
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.bothDone) {
        hapticSuccess();
        toast.success("Job completed! Payment released.");
        // Brand-tinted confetti for the first 3 completed jobs — fades to
        // silent after to avoid noise on regulars.
        const { maybeCelebrate } = await import("@/lib/celebrate");
        void maybeCelebrate("first_complete", { particleCount: 120 });
        await refresh();
        setStatusFilter("completed");

        // Tip-after-completion prompt — only for the poster (customer) side.
        // Gate on per-job relationship: the poster is the one who isn't the
        // helper on this job. Also suppress if a tip was already recorded
        // for this job (e.g. tipped earlier via the Tip button on the card).
        const isPoster = !isHelper;
        const alreadyTipped = completedJobMeta[jobId]?.tipped === true;
        if (isPoster && !alreadyTipped) {
          const postedJob = postedJobs.find((j) => j.id === jobId);
          if (postedJob?.helper_id) {
            const helperName = helperNames[postedJob.helper_id] || "your helpr";
            hapticLight();
            setCompletionPromptJob({
              job: postedJob,
              revieweeId: postedJob.helper_id,
              revieweeName: helperName,
            });
          }
        }

        // Time banking — award 60 min credit to the helper on completion.
        // Fire-and-forget; never blocks the completion flow.
        // Swallows gracefully if time_credits table isn't deployed yet (42P01).
        if (isHelper && user) {
          const postedJob =
            postedJobs.find((j) => j.id === jobId) ||
            (appliedApps.find((a) => a.job_id === jobId) as any)?.job;
          void supabase
            .from("time_credits" as any)
            .insert({
              user_id: user.id,
              amount_minutes: 60,
              credit_type: "job_completed",
              job_id: jobId,
              description: `1 hour earned for completing${postedJob?.title ? ` "${postedJob.title}"` : " a job"}`,
            })
            .then(() => {}, () => {});
        }

        // Milestone community posts — fire-and-forget when the helper
        // crosses a job-count threshold (10, 25, 50, 100, 200, 500).
        // Only generated when the helper is the one calling completeJob
        // (isHelper check). Swallows PGRST202 gracefully so this never
        // breaks the flow when the community_posts table isn't on prod yet.
        if (isHelper && user) {
          (async () => {
            try {
              const { count } = await supabase
                .from("jobs")
                .select("id", { count: "exact", head: true })
                .eq("helper_id", user.id)
                .eq("status", "completed");
              const completedCount = (count ?? 0);
              const milestones = [10, 25, 50, 100, 200, 500];
              if (milestones.includes(completedCount)) {
                const helperParish: string | null = null; // parish fetched separately if needed
                await supabase.from("community_posts").insert({
                  author_id: user.id,
                  post_type: "milestone",
                  body: `just completed their ${completedCount}${completedCount === 1 ? "st" : completedCount === 2 ? "nd" : completedCount === 3 ? "rd" : "th"} job on Helpr!`,
                  parish: helperParish,
                  is_approved: true,
                } as any);
              }
            } catch {
              // Non-fatal — milestone post is a nice-to-have
            }
          })();
        }
      } else {
        hapticMedium();
        toast.success("You've marked this job as complete. Waiting for the other party to confirm.");
        await refresh();
      }
    } catch (err: any) {
      hapticError();
      toast.error(err.message || "We couldn't mark this job complete — please try again.");
    } finally {
      setCompletingJobId(null);
    }
  };

  const resolveRevision = async (jobId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "resolve_revision", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Revision resolved! Job is back in progress.");
      refresh();
    } catch (err: any) { hapticError(); toast.error(err.message || "We couldn't resolve that revision — please try again."); }
  };

  const confirmStartJob = async (jobId: string) => {
    // Optimistic: flip the card to "In Progress" immediately.
    const snapshot = optimisticallyPatchJob(jobId, { status: "in_progress" });
    const { error } = await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);
    if (error) {
      rollbackActivity(snapshot);
      hapticError();
      toast.error("We couldn't start the job just now — please try again.");
    } else {
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Job started!", message: `The poster confirmed "${job.title}" has started.`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      toast.success("Job started! It's now in progress.");
      await refresh();
      setStatusFilter("in_progress");
    }
  };

  const confirmArrival = async (jobId: string) => {
    // Optimistic: mark arrival confirmed on the card right away.
    const arrivedAt = new Date().toISOString();
    const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_arrival_at: arrivedAt });
    const { error } = await supabase.from("jobs").update({ poster_confirmed_arrival_at: arrivedAt }).eq("id", jobId);
    if (error) { rollbackActivity(snapshot); hapticError(); toast.error("We couldn't confirm arrival just now — please try again."); return; }
    const job = postedJobs.find(j => j.id === jobId);
    if (job?.helper_id) {
      await createNotification({ user_id: job.helper_id, title: "✅ Arrival confirmed", message: `The poster confirmed you've arrived for "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
    }
    toast.success("Arrival confirmed!");
    refresh();
  };

  const confirmWorking = async (jobId: string) => {
    // Optimistic: mark "helpr working" confirmed on the card right away.
    const workingAt = new Date().toISOString();
    const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_working_at: workingAt });
    const { error } = await supabase.from("jobs").update({ poster_confirmed_working_at: workingAt }).eq("id", jobId);
    if (error) { rollbackActivity(snapshot); hapticError(); toast.error("We couldn't confirm that just now — please try again."); return; }
    const job = postedJobs.find(j => j.id === jobId);
    if (job?.helper_id) {
      await createNotification({ user_id: job.helper_id, title: "✅ Work confirmed", message: `The poster confirmed you're working on "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
    }
    toast.success("Confirmed helpr is working!");
    refresh();
  };

  const handleNoShow = async (jobId: string) => {
    if (!user) return;
    setReportingNoShow(true);
    try {
      const job = postedJobs.find((j) => j.id === jobId);
      if (!job?.helper_id) return;
      const helperId = job.helper_id;

      // Atomic via the report_helper_no_show RPC (migration
      // 20260518140000): violation, ban escalation and job reopen run
      // in one transaction. Falls back to the pre-migration multi-step
      // path if the RPC isn't deployed to this environment yet.
      let actionTaken = "warning";
      const { data: rpcData, error: rpcError } = await supabase.rpc("report_helper_no_show", {
        p_job_id: jobId,
      });

      if (rpcError) {
        const msg = String(rpcError?.message ?? "");
        const rpcMissing =
          String(rpcError?.code ?? "") === "PGRST202" ||
          /could not find the function|does not exist|schema cache/i.test(msg);
        if (!rpcMissing) { hapticError(); toast.error("Couldn't report the no-show — please try again."); return; }
        const { data: existing } = await supabase.from("user_violations").select("id").eq("user_id", helperId).eq("violation_type", "no_show");
        const priorCount = existing?.length || 0;
        actionTaken = priorCount >= 1 ? "permanent_ban" : "warning";
        await supabase.from("user_violations").insert({ user_id: helperId, violation_type: "no_show", description: `No-show for job: ${job.title}`, job_id: jobId, reported_by: user.id, action_taken: actionTaken });
        if (actionTaken === "permanent_ban") {
          await supabase.from("user_bans").insert({ user_id: helperId, ban_type: "permanent", reason: "Repeated no-show violations", banned_by: user.id });
          await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", helperId);
        } else {
          await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", helperId);
        }
        await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
      } else {
        actionTaken = (rpcData?.action as string) ?? "warning";
      }

      // Notifications (best-effort) — shared by both paths.
      const banned = actionTaken === "permanent_ban";
      await createNotification({ user_id: helperId, title: banned ? "⛔ Account banned for no-show" : "⚠️ No-show warning", message: banned ? "Your account has been permanently banned for repeated no-shows." : `You received a no-show warning for "${job.title}".`, type: "warning", link: "/profile" });
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      for (const admin of adminRoles ?? []) {
        await createNotification({ user_id: admin.user_id, title: "🚫 No-show reported", message: `Helpr no-show for "${job.title}". ${banned ? "Auto-banned." : "Warning issued."}`, type: "warning", link: "/admin" });
      }
      toast.success("No-show reported. Job reopened.");
      refresh();
    } catch (err: any) { hapticError(); toast.error(err.message || "We couldn't report the no-show just now — please try again."); }
    finally { setReportingNoShow(false); setNoShowJobId(null); }
  };

  const openReviewForPosted = async (job: Job) => {
    if (!job.helper_id) return;
    // Use shared fetchProfile so the read goes through the same code
    // path React Query callers use. Direct supabase.from inline reads
    // fragment caching across the app — see src/hooks/useProfile.ts.
    const helperProfile = await fetchProfile(job.helper_id);
    setReviewTarget({ id: job.helper_id, name: formatName(helperProfile?.full_name, "Helpr") });
    setReviewJob(job);
  };

  return {
    // UI state
    expandedJobId, setExpandedJobId,
    completingJobId,
    reportingNoShow,
    // Dialog state
    selectedJob, setSelectedJob,
    applications,
    applicationsLoading,
    applicationsError,
    inlineApplicants,
    loadingApplicants,
    applicantErrors,
    editJob, setEditJob,
    boostJobId, setBoostJobId,
    enhancedTipJobId, setEnhancedTipJobId,
    enhancedTipHelperName, setEnhancedTipHelperName,
    noShowJobId, setNoShowJobId,
    cancelDialogJob, setCancelDialogJob,
    revisionJobId, setRevisionJobId,
    deadlineDialogApp, setDeadlineDialogApp,
    completionPromptJob, setCompletionPromptJob,
    disputeJob, setDisputeJob,
    viewDisputeJob, setViewDisputeJob,
    reviewJob, setReviewJob,
    reviewTarget, setReviewTarget,
    helperReviewJob, setHelperReviewJob,
    idvDialogOpen, setIdvDialogOpen,
    idvStatus,
    idvFailureReason,
    pendingAcceptApp, setPendingAcceptApp,
    w9DialogOpen, setW9DialogOpen,
    w9Context,
    // Handlers
    loadApplications,
    loadInlineApplicants,
    acceptApplication,
    confirmAcceptWithDeadline,
    handleHelperResponse,
    tryCancelJob,
    completeJob,
    resolveRevision,
    confirmStartJob,
    confirmArrival,
    confirmWorking,
    handleNoShow,
    openReviewForPosted,
  };
}
