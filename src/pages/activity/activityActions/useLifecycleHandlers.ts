import { supabase } from "@/integrations/supabase/client";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { unwrapMutation } from "@/lib/mutationResult";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { arrivalEstablished, arrivalGateMessage } from "@/lib/arrivalGate";
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
          // ARRIVAL, not a second proximity check.
          //
          // This used to re-run a live 500ft GPS check at wrap-up time, with a
          // fallback that read `job_checkins` — a table nothing in the app has
          // ever written (0 rows in prod). So the fallback could never fire,
          // and a helper who had walked back to their van, or was inside a
          // metal building, was hard-blocked from the write that gets them
          // paid — and pointed at a "Check In with Photo" control that does
          // not exist anywhere in the codebase.
          //
          // Stepping away at the END of a job is normal and is not evidence of
          // fraud. What matters is that they WERE there, which the arrival
          // ladder records at the moment it was true: server-verified GPS, or
          // the poster's vouch (see arrivalGate.ts). The same rule is enforced
          // by enforce_helper_completion_gates, so this is the message, not
          // the gate.
          const { data: arrivalRow, error: arrivalErr } = await supabase
            .from("jobs")
            .select("helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at")
            .eq("id", jobId)
            .single();
          // Fails CLOSED (read error → can't prove arrival → block), but never
          // silently: surface it so a transient failure that's wrongly
          // blocking a legit completion is traceable.
          if (arrivalErr) {
            report(arrivalErr, { tags: { area: "activity", op: "completeJob.arrivalRead" }, context: { jobId } });
          }
          if (!arrivalEstablished(arrivalRow)) {
            hapticError();
            toast.error(arrivalGateMessage(arrivalRow), { duration: 8000 });
            return;
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
        await createNotification({ user_id: job.helper_id, title: "✅ Arrival confirmed", message: `The poster confirmed you've arrived for "${job.title}".`,
        // `?job=`, not `?filter=in_progress`: `in_progress` is a legacy filter
        // key with no chip in the five-bucket strip (activityFilters.ts), so
        // the helper landed on a filtered list with nothing selected — 17 rows
        // in prod are on it. Activity resolves the live bucket from the job id.
        type: "success", link: `/my-jobs?job=${job.id}` });
      }
      hapticSuccess();
      toast.success("Arrival confirmed!");
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
        await createNotification({ user_id: job.helper_id, title: "✅ Work confirmed", message: `The poster confirmed you're working on "${job.title}".`,
        // `?job=`, not `?filter=in_progress`: `in_progress` is a legacy filter
        // key with no chip in the five-bucket strip (activityFilters.ts), so
        // the helper landed on a filtered list with nothing selected — 17 rows
        // in prod are on it. Activity resolves the live bucket from the job id.
        type: "success", link: `/my-jobs?job=${job.id}` });
      }
      hapticSuccess();
      toast.success("Work confirmed!");
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
      if (!job?.helper_id) {
        // A BARE RETURN HERE LOOKED LIKE SUCCESS. The `finally` below closes
        // the confirm dialog either way, so "Confirm No-Show" dismissed the
        // sheet and did nothing at all — no write, no toast, no clue. The
        // usual cause is a stale list (the helper was unassigned, or this card
        // is from a previous fetch), which a refresh fixes, so say that.
        hapticError();
        toast.error("We couldn't find the Helpr on this job — pull to refresh and try again.");
        return;
      }
      const helperId = job.helper_id;

      // Atomic via the report_helper_no_show RPC (migration 20260518140000,
      // latest 20260831183302): it locks the job row FOR UPDATE, re-checks the
      // caller is the poster, records the violation, runs the shared
      // consequence ladder, and reopens the job in ONE transaction — so the
      // consequence can never be left half-applied. There is
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

      // Which rung did the RPC actually reach? Migration 20260831183302 moved
      // the top rung: a second no-show (from a DIFFERENT poster) is now a
      // REVERSIBLE 7-day restriction plus admin review — the same terminal rung
      // every other ladder uses — not an automatic permanent ban.
      //
      // "permanent_ban" is still handled, and deliberately: between this bundle
      // shipping and db-deploy.yml applying that migration, the old RPC can
      // still return it. Describing a real, irreversible ban as "under review"
      // would be the worse lie, so each string says exactly what happened.
      const restricted = actionTaken === "pending_ban_review";
      const legacyBanned = actionTaken === "permanent_ban";
      // Notifications (best-effort) — shared by every path.
      await createNotification({
        user_id: helperId,
        title: legacyBanned ? "⛔ Account banned for no-show" : restricted ? "⛔ Account restricted for 7 days" : "⚠️ No-show warning",
        message: legacyBanned
          ? "Your account has been permanently banned for repeated no-shows."
          : restricted
            ? "A second no-show was reported against you. Your account is restricted for 7 days while an admin reviews it. If you think this is wrong, email admin@louisianahelpr.com."
            : `You received a no-show warning for "${job.title}".`,
        type: "warning",
        // Warnings & Strikes, not the Profile landing tab — this notification
        // IS a strike, and `?tab=warnings` is the screen that lists it.
        link: "/profile?tab=warnings",
        // The destination is correct and carries no job id, so the job can
        // only travel as the reference. Without it "which job was I struck
        // over?" is answerable from the message text alone.
        job_id: job.id,
      });
      // Admin fan-out — a silent drop here means no admin gets the
      // no-show alert. Warn-report but continue (the poster's toast still
      // fires and the DB state is already correct).
      const { data: adminRoles, error: adminRolesErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRolesErr) {
        report(adminRolesErr, { severity: "warning", tags: { source: "useLifecycleHandlers.noShowAdminFanout" } });
      }
      for (const admin of adminRoles ?? []) {
        await createNotification({ user_id: admin.user_id, title: "🚫 No-show reported", message: `Helpr no-show for "${job.title}". ${legacyBanned ? "Auto-banned." : restricted ? "Restricted 7 days — ban review pending." : "Warning issued."}`, type: "warning", link: "/admin", job_id: job.id });
      }
      // Success feedback, in the same shape confirmArrival/confirmWorking use.
      // This handler pulls the consequence ladder — a final warning, or a
      // 7-day restriction pending admin review on the second report — and said
      // nothing when it landed, so the loudest action on the card was also the
      // only silent one. The message names which rung the RPC actually reached
      // rather than a generic "done".
      hapticSuccess();
      toast.success(
        legacyBanned
          ? "No-show reported — this Helpr has been banned for repeated no-shows."
          : restricted
            ? "No-show reported — the Helpr is restricted for 7 days while an admin reviews it, and your job is open again."
            : "No-show reported — the Helpr has been warned and your job is open again.",
      );
      refresh();
    } catch (err) { hapticError(); toast.error(err instanceof Error ? err.message : "We couldn't report the no-show just now — please try again."); }
    finally { setReportingNoShow(false); setNoShowJobId(null); }
  };

  const openReviewForPosted = async (job: Job) => {
    if (!job.helper_id) return;
    // Use shared fetchProfile so the read goes through the same code
    // path React Query callers use. Direct supabase.from inline reads
    // fragment caching across the app — see src/hooks/useProfile.ts.
    //
    // It THROWS on a Supabase error (useProfile.ts: `if (error) throw error`),
    // and this was the one call site not wrapped: the rejection escaped an
    // async click handler with nobody to catch it, so tapping Review did
    // nothing, said nothing, and logged nothing anyone would see. Every other
    // handler in this file reports and toasts; so does this one now.
    let helperProfile: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      helperProfile = await fetchProfile(job.helper_id);
    } catch (err) {
      report(err, {
        tags: { area: "activity", op: "openReviewForPosted.fetchProfile" },
        context: { jobId: job.id, helperId: job.helper_id },
      });
      hapticError();
      toast.error("We couldn't open the review just now — please try again.");
      return;
    }
    setReviewTarget({ id: job.helper_id, name: formatName(helperProfile?.full_name, "Helpr") });
    setReviewJob(job);
  };

  return {
    tryCancelJob,
    completeJob,
    resolveRevision,
    confirmArrival,
    confirmWorking,
    handleNoShow,
    openReviewForPosted,
  };
}
