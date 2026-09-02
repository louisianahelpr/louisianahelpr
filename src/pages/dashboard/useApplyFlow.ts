import { useState, useCallback, useEffect } from "react";
import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { User as SupaUser } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorToast } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { assertWritable } from "@/hooks/useImpersonation";
import { track, AhaEvent } from "@/lib/analytics";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { requireOnline } from "@/lib/requireOnline";
import { checkApplicationRate, recordApplicationAttempt } from "@/lib/applyRateLimit";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { ApplyVars, ApplySnapshot, DashboardContextSlice } from "./dashboardTypes";
import { userFacingError } from "@/lib/userFacingError";

// The apply_to_job RPC RAISEs these exact strings for the states a helper can
// actually hit (see 20260612450000_apply_to_job_rate_limit.sql). Map each to a
// warm, human toast so the real reason surfaces instead of the generic
// "Couldn't send your application through" fallback. Keys MUST match the RPC's
// RAISE text verbatim — a drift here silently falls back to the generic toast.
const APPLY_RPC_MESSAGES: Record<string, string> = {
  "Already applied to this job": "You've already applied to this job.",
  "Cannot apply to your own job": "You can't apply to your own post.",
  "Job is no longer accepting applications": "This task isn't accepting applications anymore.",
  "Job not found": "This task is no longer available.",
};

type UseApplyFlowArgs = {
  user: SupaUser | null;
  allJobs: EnrichedJob[];
};

export function useApplyFlow({ user, allJobs }: UseApplyFlowArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [confirmApplyJobId, setConfirmApplyJobId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
  // A deep-linked apply (?quickApply=<id>) can target a job that isn't in the
  // dashboard feed — filtered out, in another area, or the feed simply hasn't
  // loaded it. The confirm dialog needs the job object (title, budget,
  // pricing_mode, instant_book, is_urgent, date_needed, category) to render its
  // earnings breakdown and tips, so when the id is absent from `allJobs` we
  // fetch the single row (RLS still applies) and use it as the fallback source.
  const [fetchedJob, setFetchedJob] = useState<EnrichedJob | null>(null);
  const feedJob = allJobs.find((j) => j.id === confirmApplyJobId) || null;
  const confirmApplyJob =
    feedJob || (fetchedJob?.id === confirmApplyJobId ? fetchedJob : null);

  useEffect(() => {
    // No pending confirm, or the feed already has the job → nothing to fetch.
    if (!confirmApplyJobId || feedJob) return;
    // Already fetched this exact id → don't refetch on every render.
    if (fetchedJob?.id === confirmApplyJobId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("jobs")
        // NAMED COLUMNS, NOT `*`. This read is the reason the "Applicants can
        // view their pending applied jobs" policy existed, and under it `*`
        // handed a helper who had merely tapped Apply the job's full street
        // address and exact lat/lng — proven against prod rows. That policy is
        // dropped by `20260831232513_address_only_when_offered`, so this read
        // now returns nothing until the poster actually chooses this helper.
        // The list is exactly what the confirm dialog renders (see the comment
        // above); the apply mutation itself only needs the id, so the
        // best-effort miss below is unchanged in behaviour.
        .select(
          "id, title, budget, category, date_needed, pricing_mode, instant_book, is_urgent, customer_id, status",
        )
        .eq("id", confirmApplyJobId)
        .maybeSingle();
      // Best-effort: a miss/RLS-denial just leaves confirmApplyJob null and the
      // dialog falls back to its generic copy — the apply mutation itself only
      // needs the jobId, so a failed fetch never blocks applying.
      if (!cancelled && !error && data) setFetchedJob(data as EnrichedJob);
    })();
    return () => { cancelled = true; };
  }, [confirmApplyJobId, feedJob, fetchedJob]);

  /* Returns TRUE only when the request was accepted and a confirm id was set.
     The job-detail sheet uses that answer to decide whether to swap itself to
     the apply step: every `return` below is a refusal (offline, impersonating,
     signed out, your own post) that leaves confirmApplyJobId null, and
     swapping on a refusal would show an apply form for no job. */
  const handleApplyRequest = useCallback(async (jobId: string) => {
    if (!requireOnline()) return false;
    // Read-only impersonation: when an admin is viewing the app as another
    // user (?impersonate=<id>), block writes so the admin can't accidentally
    // apply on the user's behalf. See useImpersonation.
    if (!assertWritable()) return false;
    hapticMedium(); // confirm tap on Apply
    if (!user) { navigate("/login"); return false; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return false; }

    // Applying to a job never prompts identity verification — that gate belongs
    // to posting a job and to a helper's first accepted job, not to browsing +
    // applying. Go straight to the apply confirmation.
    setConfirmApplyJobId(jobId);
    return true;
  }, [user, allJobs, navigate]);

  // Optimistic Apply. The moment a helper hits "Apply now" we:
  //   1) close the dialog,
  //   2) optimistically add this job's id to `dashboardContext.appliedJobIds`
  //      so the feed filter (`!appliedJobIds.has(j.id)`) removes the row
  //      across every loaded page of the infinite query — the card vanishes
  //      in the same frame as the tap (no spinner, no Stripe-style wait).
  // The file-upload + insert run in the background; on error we restore
  // the snapshots so the job re-appears and the user can retry.
  const applyMutation = useMutation<void, Error & { code?: string }, ApplyVars, ApplySnapshot>({
    mutationFn: async ({ jobId, helperId, message, files, isInstantBook }) => {
      // Server-side rate limit check (10/min, 50/hr, 200/day) BEFORE any
      // attachment uploads — don't waste storage bandwidth on a blocked
      // attempt. The helper falls back to "allowed" if the RPC isn't
      // deployed yet (PGRST202), so this doesn't break apply on prod
      // between merge and the manual supabase db push.
      const gate = await checkApplicationRate({ applicantId: helperId });
      if (gate.allowed === false) {
        throw Object.assign(new Error(gate.message), { code: "RATE_LIMITED" });
      }
      // Upload attachments first (store storage paths; resolve signed URLs at view time).
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const path = `${helperId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("application-attachments")
          .upload(path, file);
        if (uploadErr) {
          // Re-throw with a friendly file-specific message so onError can toast it.
          throw Object.assign(new Error(`Failed to upload ${file.name}`), { code: "UPLOAD_FAILED" });
        }
        attachmentUrls.push(path);
      }
      // Try the apply_to_job RPC first.
      // Fall back to a direct INSERT if PGRST202 (function not yet deployed to prod).
      // apply_to_job isn't in the generated Functions map yet (migration
      // unapplied to prod), so we call it through a narrowly-typed wrapper
      // documenting its exact arg/return contract instead of `as any`.
      // MUST call as a method on `supabase` (or bind) — supabase-js `rpc`
      // reads `this.rest` internally, so a detached `const fn = supabase.rpc`
      // call throws "Cannot read properties of undefined (reading 'rest')".
      const applyToJobRpc = supabase.rpc.bind(supabase) as unknown as (
        fn: "apply_to_job",
        // `p_proposed_price` is deliberately NOT passed. Bidding was removed
        // (PRICING_MODE_REMOVED in BudgetSection); the RPC still declares the
        // parameter with a NULL default, so omitting it is both correct and
        // forward-compatible with the migration that eventually drops it.
        args: { p_job_id: string; p_message: string | null },
      ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>;
      const { data: rpcData, error: rpcError } = await applyToJobRpc("apply_to_job", {
        p_job_id: jobId,
        p_message: message.trim() || null,
      });
      if (rpcError) {
        const errCode = (rpcError as { code?: string }).code;
        if (errCode !== "PGRST202") {
          // Rate limit errors from apply_to_job come back as PostgrestError with
          // .message = "rate_limit_minute" / "rate_limit_hour" / "rate_limit_day".
          // Convert them to a RATE_LIMITED throw so onError can toast the right copy.
          const msg = (rpcError as { message?: string }).message ?? "";
          if (msg === "rate_limit_minute") {
            throw Object.assign(new Error("Slow down — you can apply again in a minute."), { code: "RATE_LIMITED" });
          }
          if (msg === "rate_limit_hour") {
            throw Object.assign(new Error("You've applied to a lot of jobs this hour — try again in a bit."), { code: "RATE_LIMITED" });
          }
          if (msg === "rate_limit_day") {
            throw Object.assign(new Error("You've hit today's application limit — check back tomorrow."), { code: "RATE_LIMITED" });
          }
          // Real error (duplicate, job closed, price-required, etc.) — surface it.
          throw rpcError as Error & { code?: string };
        }
        // PGRST202: apply_to_job not deployed yet — fall back to direct INSERT
        // (no proposed_price column yet; no harm, it's not on prod either).
        const { error } = await supabase.from("applications").insert({
          job_id: jobId,
          helper_id: helperId,
          message: message.trim() || null,
          attachment_urls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        });
        if (error) throw error as Error & { code?: string };
      } else {
        void rpcData; // UUID returned but not currently used.
        // Patch attachment_urls onto the new row if needed (RPC doesn't handle attachments).
        if (attachmentUrls.length > 0) {
          // Both the error AND the row count matter here, and neither was
          // being read. `.update().eq(...)` with no `.select()` resolves
          // `{data: null, error: null}` whether it matched one row or none, so
          // an RLS-blocked or mis-targeted patch was indistinguishable from
          // success — the helper's application landed with their files
          // silently dropped and the success toast fired anyway.
          //
          // This does NOT throw: the application itself already landed via the
          // RPC, and throwing here would roll the UI back to "apply failed"
          // over a row that exists. Warn instead, so the helper knows to
          // re-attach from Activity rather than assuming the files went.
          const { data: patched, error: attachErr } = await supabase.from("applications")
            .update({ attachment_urls: attachmentUrls })
            .eq("job_id", jobId)
            .eq("helper_id", helperId)
            .select("id");
          if (attachErr || !patched || patched.length === 0) {
            toast.warning("Your application was sent, but the attachments didn't save — add them from Activity.");
          }
        }
      }
      // Insert succeeded — bump the rate-limit counter. Best-effort: a
      // failed record call shouldn't surface to the user since the apply
      // already landed. PGRST202 is silently no-op'd inside the helper.
      void recordApplicationAttempt({ applicantId: helperId });

      // Instant-book: auto-confirm immediately after applying, mirroring the
      // direct-offer accept path (helper_confirmed_at set, no poster review).
      // Wrapped in try/catch so a failure here (e.g. column not on prod yet)
      // degrades gracefully — the application still lands, the job just needs
      // manual poster acceptance. The `helper_confirmed_at` column is NOT
      // instant_book-specific; it's the same field set in handleHelperResponse.
      if (isInstantBook) {
        // Claim through the RPC, never a direct table UPDATE. The previous
        // client-side `.update({helper_id, status:"accepted"}).eq("id", jobId)`
        // was a silent no-op: at claim time helper_id is still NULL, so the
        // "Helpers can update their assigned jobs" RLS policy
        // (USING auth.uid() = helper_id) made the row invisible and the UPDATE
        // matched zero rows — which is a SUCCESS, not an error, so the
        // try/catch never fired. Instant Book has therefore never worked, while
        // the UI promised it ("Instant book" badge, "Book now" button).
        // instant_book_claim() locks the job and re-checks every precondition,
        // so two simultaneous claims resolve to exactly one winner.
        // `as any` matches the established pattern for an RPC that isn't in the
        // generated types yet (see business_activity_feed, approve_pending_job,
        // update_business_member_role). Regenerating via `npm run db:types`
        // after this migration deploys will make the cast unnecessary.
        const { error: claimError } = await supabase.rpc("instant_book_claim" as any, {
          p_job_id: jobId,
        } as any);
        // PGRST202 = the function isn't deployed yet (the window between this
        // commit merging and db-deploy finishing). Degrade to the normal
        // application flow rather than failing the apply that already landed.
        if (claimError && claimError.code !== "PGRST202") {
          throw claimError;
        }
      }
    },
    onMutate: async ({ jobId, helperId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.context(helperId) });
      const previousContext = queryClient.getQueryData(queryKeys.dashboard.context(helperId));
      // Optimistically widen appliedJobIds so the feed filter drops this
      // job from every loaded page of the infinite query immediately.
      queryClient.setQueryData<DashboardContextSlice>(queryKeys.dashboard.context(helperId), (prev) => {
        if (!prev) return prev;
        const nextApplied = new Set<string>(prev.appliedJobIds ?? []);
        nextApplied.add(jobId);
        return { ...prev, appliedJobIds: nextApplied };
      });
      return { previousContext, userId: helperId };
    },
    onError: (err, vars, context) => {
      hapticError();
      // Roll the appliedJobIds set back so the card re-appears in the feed.
      if (context) {
        queryClient.setQueryData(queryKeys.dashboard.context(context.userId), context.previousContext);
      }
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        toast.error("You've already applied.");
      } else if (code === "UPLOAD_FAILED") {
        // Upload errors are usually a flaky-network attachment — Retry is
        // genuinely useful here. The mutation already rolled back the
        // appliedJobIds set, so the apply is in a clean state to re-run.
        errorToast(err.message, {
          onRetry: () => applyMutation.mutate(vars),
        });
      } else if (code === "RATE_LIMITED") {
        // Use the warm, window-specific message from applyRateLimit.
        // No retry — by definition the user has to wait the window out.
        toast.error(userFacingError(err, "Couldn't send your application — try again?"));
      } else if (APPLY_RPC_MESSAGES[(err as { message?: string } | null)?.message ?? ""]) {
        // The apply_to_job RPC RAISEs a specific human reason (empty bid price,
        // already applied, own job, job closed, not found). Surface THAT reason
        // instead of burying it under the generic "something went wrong" toast —
        // these are actionable states the helper can fix, not transient blips,
        // so no Retry button (re-running the same invalid submit just re-fails).
        toast.error(APPLY_RPC_MESSAGES[(err as { message?: string }).message!]);
      } else {
        errorToast("Couldn't send your application through", {
          description: "Tap retry to try again.",
          onRetry: () => applyMutation.mutate(vars),
        });
      }
    },
    onSuccess: async (_data, vars) => {
      hapticSuccess();
      // First job action recorded — gates the deferred notification
      // permission prompt (`useNotificationPermissionPrompt`). The
      // helper is idempotent, so this is safe even on the 100th apply.
      recordJobActionForPermissionPrompt();
      // Funnel: track first application separately for activation analysis.
      track(AhaEvent.JobApplied, { job_id: vars.jobId, instant_book: vars.isInstantBook ?? false });
      // Confirm to the helper FIRST — the insert has landed, so the success
      // toast is owed regardless of whatever analytics/reconciliation runs
      // afterward. Previously this fired AFTER an unguarded `await` on the
      // first-application count query below; any throw there (a transient
      // network blip, an RLS hiccup) silently skipped the toast entirely, so
      // the helper saw the card vanish from Browse with no confirmation and
      // no obvious way to find the application again. Toast up front =
      // confirmation can never be swallowed by a later best-effort call.
      // `?job=` — not a bare "/my-jobs". My Jobs opens on the "Needs you"
      // bucket, and neither of these two lands there: a booking the helper has
      // already confirmed is `scheduled`, and an application awaiting the
      // poster's decision is `waiting`. Tapping View went to an empty list
      // both times. Activity resolves `?job=` to whichever bucket the job is
      // in right now (see the deep-link effect in pages/Activity.tsx), so the
      // card is on screen and pulsing whatever state it is in.
      if (vars.isInstantBook) {
        toast.success("You're booked! Check My Jobs for details.", {
          action: { label: "View", onClick: () => navigate(`/my-jobs?job=${vars.jobId}`) },
        });
      } else {
        toast.success("Application sent! Track it in My Jobs.", {
          action: { label: "View", onClick: () => navigate(`/my-jobs?job=${vars.jobId}`) },
        });
      }
      // First-application funnel event — strictly best-effort analytics, so
      // it must never break (or block) the apply flow. Isolated in its own
      // try/catch and we explicitly inspect the Supabase `error` instead of
      // dropping it (project rule: never `const { count } = await supabase…`
      // and silently swallow a failure).
      try {
        const { count, error: countError } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("helper_id", vars.helperId);
        if (!countError && (count ?? 0) <= 1) {
          track(AhaEvent.FirstJobApplication, { job_id: vars.jobId });
        }
      } catch {
        // Analytics-only — a failed count must not affect the user-visible
        // apply outcome (toast already shown, onSettled still reconciles).
      }
    },
    onSettled: async (_data, _err, vars) => {
      // Reconcile against the server now that the optimistic state has
      // either been confirmed or rolled back. Predicate match catches
      // ["dashboardJobs", userId], ["applications", ...], ["jobs", jobId],
      // etc. without needing every caller to know the exact shape.
      await queryClient.invalidateQueries({
        predicate: (q: Query) => {
          const k = q.queryKey?.[0];
          return k === "dashboardJobs"
            || k === "dashboardContext"
            || k === "applications"
            || k === "jobs"
            || k === "activity";
        },
      });
      void vars;
    },
  });

  const handleApplyConfirm = useCallback(() => {
    if (!user || !confirmApplyJobId || applyLoading) return;
    const jobId = confirmApplyJobId;
    const files = applyFiles;
    const message = applyMessage;
    // Read the instant_book flag from the job in the feed. Cast through
    // `any` because EnrichedJob predates this column; the DB default is
    // false so a missing key is treated the same way.
    const isInstantBook = !!confirmApplyJob?.instant_book;
    // Close the dialog + reset its state synchronously so the next paint
    // already has the optimistic feed. The mutation continues in the
    // background; React Query's onError rolls things back on failure.
    setConfirmApplyJobId(null);
    setApplyMessage("");
    setApplyFiles([]);
    // setApplyLoading flips off on settled (handled below) — we still
    // set it true here so a fast double-tap can't enqueue twice.
    setApplyLoading(true);
    applyMutation.mutate(
      { jobId, helperId: user.id, message, files, isInstantBook },
      { onSettled: () => setApplyLoading(false) },
    );
  }, [user, confirmApplyJobId, confirmApplyJob, applyLoading, applyFiles, applyMessage, applyMutation]);

  return {
    confirmApplyJobId,
    setConfirmApplyJobId,
    confirmApplyJob,
    applyMessage,
    setApplyMessage,
    applyLoading,
    applyFiles,
    setApplyFiles,
    handleApplyRequest,
    handleApplyConfirm,
  };
}
