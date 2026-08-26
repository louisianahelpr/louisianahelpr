import { supabase } from "@/integrations/supabase/client";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { unwrapMutation } from "@/lib/mutationResult";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { checkProximity } from "@/lib/locationUtils";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";
import { fetchProfile } from "@/hooks/useProfile";
import { fireSuccessMoment } from "@/lib/successMoment";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";
import type { OptimisticJobCache } from "./types";

/**
 * Dependencies for the in-progress → completion → review lifecycle handlers,
 * extracted verbatim from useActivityActions. Cache helpers, per-action state
 * setters and the parent data (postedJobs/appliedApps/helperNames/…) are
 * passed in so every handler behaves identically to its in-hook original.
 */
export interface LifecycleHandlersDeps extends OptimisticJobCache {
  user: SupaUser | null;
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  refresh: () => void | Promise<unknown>;
  setStatusFilter: (filter: string) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  setCompletingJobId: (id: string | null) => void;
  setReportingNoShow: (v: boolean) => void;
  setNoShowJobId: (id: string | null) => void;
  setCancelDialogJob: (job: Job | null) => void;
  setCompletionPromptJob: (v: { job: Job; revieweeId: string; revieweeName: string } | null) => void;
  setReviewTarget: (v: { id: string; name: string } | null) => void;
  setReviewJob: (job: Job | null) => void;
  setConfirmingArrivalJobId: (id: string | null) => void;
  setConfirmingWorkingJobId: (id: string | null) => void;
  setConfirmingStartJobId: (id: string | null) => void;
}

export function createLifecycleHandlers(deps: LifecycleHandlersDeps) {
  const {
    user,
    postedJobs,
    appliedApps,
    refresh,
    setStatusFilter,
    helperNames,
    completedJobMeta,
    optimisticallyPatchJob,
    rollbackActivity,
    setCompletingJobId,
    setReportingNoShow,
    setNoShowJobId,
    setCancelDialogJob,
    setCompletionPromptJob,
    setReviewTarget,
    setReviewJob,
    setConfirmingArrivalJobId,
    setConfirmingWorkingJobId,
    setConfirmingStartJobId,
  } = deps;

  const tryCancelJob = async (job: Job) => {
    const { data: tracking, error: trackingErr } = await supabase.from("job_tracking").select("status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1);
    // Fail CLOSED: if we can't read the tracking status we cannot prove the
    // Helpr isn't already en route/working, so block the cancel rather than
    // silently letting a false-negative through (the guard is the only thing
    // stopping a poster cancelling a job the Helpr has already started).
    if (trackingErr) {
      report(trackingErr, { tags: { area: "activity", op: "tryCancelJob.trackingRead" }, context: { jobId: job.id } });
      hapticError();
      toast.error("We couldn't check this job's status. Please try again in a moment.", { duration: 5000 });
      return;
    }
    const trackingStatus = tracking?.[0]?.status;
    if (trackingStatus && ["on_the_way", "arrived", "working", "done"].includes(trackingStatus)) {
      hapticError();
      toast.error("This job can't be cancelled — the Helpr is already on the way or working.", { duration: 5000 });
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
            const { data: arrivalCheckins, error: arrivalErr } = await supabase
              .from("job_checkins")
              .select("id")
              .eq("job_id", jobId)
              .eq("user_id", user!.id)
              .in("type", ["arrival", "arrival_photo"])
              .limit(1);
            // Gate fails CLOSED (a read error → no proof of arrival → block),
            // but never silently: surface it so a transient failure that's
            // wrongly blocking a legit completion is traceable.
            if (arrivalErr) {
              report(arrivalErr, { tags: { area: "activity", op: "completeJob.arrivalRead" }, context: { jobId } });
            }

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

          // ONE shared proof rule (photoProofPolicy): before & after photos
          // on every job — the same predicate the payout CTA and the
          // tracker's Done step enforce. This re-check used to require only
          // after-photos on $50+ jobs, a third variant of the rule that let
          // a completion slip through a gate the buttons claimed to hold.
          {
            const { data: jobData, error: proofErr } = await supabase
              .from("jobs")
              .select("proof_before_urls, proof_after_urls")
              .eq("id", jobId)
              .single();
            // Fails CLOSED (read error → treated as missing proof → block the
            // completion), but report it so the failure isn't invisible.
            if (proofErr) {
              report(proofErr, { tags: { area: "activity", op: "completeJob.proofRead" }, context: { jobId } });
            }
            if (!hasRequiredProof(job, jobData?.proof_before_urls, jobData?.proof_after_urls)) {
              hapticError();
              toast.error(requiredProof(job).reason, { duration: 6000 });
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
        // Premium checkmark beat on every completion (self-respects reduced
        // motion). The brand confetti below is the *extra* novelty for the
        // first 3 completions only — the two layers don't conflict (centered
        // check vs. raining particles), so this isn't a double-fire.
        fireSuccessMoment({ label: "Job completed" });
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
            const helperName = helperNames[postedJob.helper_id] || "your Helpr";
            hapticLight();
            setCompletionPromptJob({
              job: postedJob,
              revieweeId: postedJob.helper_id,
              revieweeName: helperName,
            });
          }
        }

        // Home-autopilot: auto-create/update a maintenance reminder for
        // the poster so they know when to re-book this category of work.
        // Fire-and-forget; PGRST202 (table not deployed) degrades silently.
        if (isPoster && user) {
          (async () => {
            try {
              const postedJob = postedJobs.find((j) => j.id === jobId);
              if (postedJob?.category) {
                const intervalDays: Record<string, number> = {
                  cleaning: 42,
                  yard_work: 14,
                  pet_care: 7,
                  handyman: 180,
                  painting: 365,
                };
                const interval = intervalDays[postedJob.category] ?? 90;
                const today = new Date().toISOString().split("T")[0];
                const nextDate = new Date(Date.now() + interval * 86400_000)
                  .toISOString()
                  .split("T")[0];
                await supabase
                  .from("home_maintenance_reminders")
                  .upsert(
                    {
                      user_id: user.id,
                      category: postedJob.category,
                      last_job_id: jobId,
                      last_completed_date: today,
                      reminder_interval_days: interval,
                      next_reminder_date: nextDate,
                      is_active: true,
                    },
                    { onConflict: "user_id,category" },
                  );
              }
            } catch {
              // Non-fatal — reminder is a nice-to-have
            }
          })();
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
                });
              }
            } catch {
              // Non-fatal — milestone post is a nice-to-have
            }
          })();
        }
      } else {
        hapticMedium();
        await refresh();
        // One-time Instant Release offer (owner, 2026-08-24): the toggle
        // lives on the Auto-Tip page where nobody stumbles onto it — the
        // moment adoption actually happens is right after a poster's second
        // smooth approval. Offered once, tracked locally; every guard fails
        // toward silence (a missed offer costs nothing, a nagging one does).
        try {
          const OFFER_KEY = "helpr_instant_release_offered";
          if (user?.id && !safeStorage.getItem(OFFER_KEY)) {
            const [{ count }, { data: prof }] = await Promise.all([
              supabase.from("jobs").select("id", { count: "exact", head: true })
                .eq("customer_id", user.id).eq("status", "completed"),
              supabase.from("profiles").select("auto_release_on_complete")
                .eq("user_id", user.id).maybeSingle(),
            ]);
            if ((count ?? 0) >= 2 && !prof?.auto_release_on_complete) {
              safeStorage.setItem(OFFER_KEY, new Date().toISOString());
              toast("Enjoying smooth jobs?", {
                description:
                  "Turn on Instant Release and payment goes out the moment your Helpr marks done with photo proof — no 24-hour wait.",
                duration: 10_000,
                action: { label: "Turn It On", onClick: () => { window.location.href = "/auto-tip"; } },
              });
            }
          }
        } catch {
          // Non-fatal — the perk offer is a nice-to-have.
        }
      }
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't mark this job complete — please try again.");
    } finally {
      setCompletingJobId(null);
    }
  };

  const resolveRevision = async (jobId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "resolve_revision", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      hapticSuccess();
      refresh();
    } catch (err) { hapticError(); toast.error(err instanceof Error ? err.message : "We couldn't resolve that revision — please try again."); }
  };

  const confirmStartJob = async (jobId: string) => {
    setConfirmingStartJobId(jobId);
    try {
      // Optimistic: flip the card to "In Progress" immediately.
      const snapshot = optimisticallyPatchJob(jobId, { status: "in_progress" });
      // .select("id"): a zero-row update (RLS, the job already moved on)
      // returns error === null, which used to leave the card optimistically
      // showing "In Progress" over a row that never changed.
      let started = true;
      try {
        unwrapMutation(
          await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId).select("id"),
          {
            action: "start this job",
            rejectedMessage: "We couldn't start this job — it may have already started or been cancelled. Pull to refresh.",
            context: { jobId },
          },
        );
      } catch (err) {
        started = false;
        rollbackActivity(snapshot);
        hapticError();
        toast.error(lifecycleErrorMessage(err) ?? "We couldn't start the job just now — please try again.");
      }
      if (started) {
        const job = postedJobs.find(j => j.id === jobId);
        if (job?.helper_id) {
          await createNotification({ user_id: job.helper_id, title: "✅ Job started!", message: `The poster confirmed "${job.title}" has started.`, type: "success", link: "/my-jobs?filter=in_progress" });
        }
        hapticSuccess();
        await refresh();
        setStatusFilter("in_progress");
      }
    } finally {
      setConfirmingStartJobId(null);
    }
  };

  const confirmArrival = async (jobId: string) => {
    setConfirmingArrivalJobId(jobId);
    try {
      // Optimistic: mark arrival confirmed on the card right away.
      const arrivedAt = new Date().toISOString();
      const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_arrival_at: arrivedAt });
      try {
        unwrapMutation(
          await supabase.from("jobs").update({ poster_confirmed_arrival_at: arrivedAt }).eq("id", jobId).select("id"),
          {
            action: "confirm arrival",
            rejectedMessage: "We couldn't confirm arrival — this job may have already been cancelled. Pull to refresh.",
            context: { jobId },
          },
        );
      } catch (err) {
        rollbackActivity(snapshot);
        hapticError();
        toast.error(lifecycleErrorMessage(err) ?? "We couldn't confirm arrival just now — please try again.");
        return;
      }
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Arrival confirmed", message: `The poster confirmed you've arrived for "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      refresh();
    } finally {
      setConfirmingArrivalJobId(null);
    }
  };

  const confirmWorking = async (jobId: string) => {
    setConfirmingWorkingJobId(jobId);
    try {
      // Optimistic: mark "helpr working" confirmed on the card right away.
      const workingAt = new Date().toISOString();
      const snapshot = optimisticallyPatchJob(jobId, { poster_confirmed_working_at: workingAt });
      try {
        unwrapMutation(
          await supabase.from("jobs").update({ poster_confirmed_working_at: workingAt }).eq("id", jobId).select("id"),
          {
            action: "confirm the Helpr is working",
            rejectedMessage: "We couldn't confirm that — this job may have already been cancelled. Pull to refresh.",
            context: { jobId },
          },
        );
      } catch (err) {
        rollbackActivity(snapshot);
        hapticError();
        toast.error(lifecycleErrorMessage(err) ?? "We couldn't confirm that just now — please try again.");
        return;
      }
      const job = postedJobs.find(j => j.id === jobId);
      if (job?.helper_id) {
        await createNotification({ user_id: job.helper_id, title: "✅ Work confirmed", message: `The poster confirmed you're working on "${job.title}".`, type: "success", link: "/my-jobs?filter=in_progress" });
      }
      refresh();
    } finally {
      setConfirmingWorkingJobId(null);
    }
  };

  const handleNoShow = async (jobId: string) => {
    if (!user) return;
    setReportingNoShow(true);
    try {
      const job = postedJobs.find((j) => j.id === jobId);
      if (!job?.helper_id) return;
      const helperId = job.helper_id;

      // Atomic via the report_helper_no_show RPC (migration 20260518140000):
      // it locks the job row FOR UPDATE, re-checks the caller is the poster,
      // records the violation, escalates the 2-strike ban, and reopens the job
      // in ONE transaction — so the ban can never be left half-applied. There is
      // deliberately no client-side multi-step fallback: a browser cannot roll
      // back writes already committed, so the only correct path is the
      // server-side transaction. On ANY RPC error we fail closed (no partial
      // side effects) rather than re-implementing the escalation client-side.
      const { data: rpcData, error: rpcError } = await supabase.rpc("report_helper_no_show", {
        p_job_id: jobId,
      });
      if (rpcError) {
        report(rpcError, { tags: { area: "activity", op: "handleNoShow.rpc" }, context: { jobId, helperId } });
        hapticError();
        // The RPC's preconditions (funded job, start time passed, one report
        // per job) are things the poster can act on, so say which one stopped
        // them. "Please try again" was actively wrong advice for a guard that
        // will keep refusing until the start time passes.
        toast.error(
          lifecycleErrorMessage(rpcError) ?? "Couldn't report the no-show — please try again.",
        );
        return;
      }
      // RPC returns a Json blob (typed as `Json` in the generated types);
      // narrow to the shape the RPC emits before reading fields.
      const actionTaken = ((rpcData ?? {}) as { action?: string }).action ?? "warning";

      // Notifications (best-effort) — shared by both paths.
      const banned = actionTaken === "permanent_ban";
      await createNotification({ user_id: helperId, title: banned ? "⛔ Account banned for no-show" : "⚠️ No-show warning", message: banned ? "Your account has been permanently banned for repeated no-shows." : `You received a no-show warning for "${job.title}".`, type: "warning", link: "/profile" });
      // Admin fan-out — a silent drop here means no admin gets the
      // no-show alert. Warn-report but continue (the poster's toast still
      // fires and the DB state is already correct).
      const { data: adminRoles, error: adminRolesErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRolesErr) {
        report(adminRolesErr, { severity: "warning", tags: { source: "useLifecycleHandlers.noShowAdminFanout" } });
      }
      for (const admin of adminRoles ?? []) {
        await createNotification({ user_id: admin.user_id, title: "🚫 No-show reported", message: `Helpr no-show for "${job.title}". ${banned ? "Auto-banned." : "Warning issued."}`, type: "warning", link: "/admin" });
      }
      refresh();
    } catch (err) { hapticError(); toast.error(err instanceof Error ? err.message : "We couldn't report the no-show just now — please try again."); }
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
