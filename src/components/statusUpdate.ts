import { announceTransition } from "@/components/whatNext/HelperDoneWhatNext";
import { TRANSITION_TOAST } from "@/components/job-card/trackerTransitionCopy";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { arrivalEstablished, arrivalGateMessage, arrivalRefusalFromError, arrivalRefusalMessage, arrivalVerdictFromRpc, arrivalVerdictMessage, type ArrivalRefusal } from "@/lib/arrivalGate";
import { report } from "@/lib/errorLogger";
import { trackJobCompleted } from "@/lib/jobCompletedEvent";
import { fireSuccessMoment } from "@/lib/successMoment";
import { isExpectedLifecycleRefusal, lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isMissingRpcNamed } from "@/lib/missingRpc";

import type { Dispatch, SetStateAction } from "react";
import type { JobTrackingModel, TrackingData } from "./JobTracking";
import type { trackingLocation } from "./trackingLocation";

type Loc = ReturnType<typeof trackingLocation>;
/** Exactly the values runStatusUpdate's closure captured inside JobTracking, at their declared types. */
export type StatusUpdateDeps = {
  jobId: string;
  helperId: string | null;
  isHelper: boolean;
  tracking: TrackingData | null;
  setTracking: Dispatch<SetStateAction<TrackingData | null>>;
  setUpdating: Dispatch<SetStateAction<boolean>>;
  setArrivalRefusal: Dispatch<SetStateAction<ArrivalRefusal | { kind: "denied" } | null>>;
  setJobStamps: Dispatch<SetStateAction<JobTrackingModel["jobStamps"]>>;
  loadTracking: () => Promise<void>;
  getLocation: Loc["getLocation"];
  getLocationOutcome: Loc["getLocationOutcome"];
  applyArrivalVerdict: Loc["applyArrivalVerdict"];
};

/**
 * The open tracker's status-transition handler (Q806, 2026-11-05: moved VERBATIM out of JobTracking.tsx; no logic
 * change). Lifecycle RPCs and escrow-adjacent writes: money-reviewed before it lands.
 */
export function statusUpdate(d: StatusUpdateDeps) {
  const { jobId, helperId, isHelper, tracking, setTracking, setUpdating, setArrivalRefusal, setJobStamps, loadTracking, getLocation, getLocationOutcome, applyArrivalVerdict } = d;
  const runStatusUpdate = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);

    // ── EVERY GATE RUNS BEFORE EVERY WRITE ──
    //
    // These three checks used to sit AFTER the job_tracking row had already
    // been updated to the new status, so a REJECTED "Done" left
    // `job_tracking.status = 'done'` persisted on the server while
    // `helper_completed_at` was never written and no payout was requested.
    // `deriveCurrentStatusIdx` takes the max of the tracking row and the jobs
    // row, so the rail painted fully green through Done — and each rejection
    // path then called loadTracking(), re-reading the row it had just poisoned.
    // The poster saw the identical false state over the job_tracking realtime
    // channel. Nothing may be persisted until every gate has passed, and these
    // paths deliberately do NOT loadTracking(): nothing was written, so there
    // is nothing to re-read.
    //
    // SAME GATES AS PayoutPrimary's "Mark it done" (owner, 2026-08-24 E2E): this
    // button used to write helper_completed_at with no checks at all, so the
    // before/after-photo requirement and the 30-minute work floor on the payout
    // CTA were decorative — the tracker was a free bypass that still started
    // the auto-release clock. Fetch the row fresh (this component isn't handed
    // proof URLs) and enforce both, with the reason stated. The poster's
    // working-confirmation is deliberately NOT required (owner): a ghosting
    // poster must not be able to block the payout request — they keep the
    // review window instead.
    //
    // Running ahead of getLocation() is deliberate as well: a helper who
    // cannot complete yet should not be made to answer a location prompt first.
    if (newStatus === "done") {
      const { data: gate, error: gateErr } = await supabase
        .from("jobs")
        .select("proof_before_urls, proof_after_urls, require_photo_proof, poster_confirmed_working_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, helper_arrival_near_miss_at")
        .eq("id", jobId)
        .single();
      if (gateErr) {
        report(gateErr, { tags: { source: "JobTracking.doneGateFetch" } });
        hapticError();
        toast.error("Couldn't check the job's completion requirements — try again?");
        setUpdating(false);
        return;
      }
      // ARRIVAL FIRST — the same rule completeJob and the DB trigger use.
      // This replaces nothing on this path (the tracker's Done step never
      // checked location at all), but it is the gate the payout CTA now
      // enforces, and the two must not disagree again.
      if (!arrivalEstablished(gate)) {
        hapticError();
        toast.error(arrivalGateMessage(gate), { duration: 8000 });
        setUpdating(false);
        return;
      }
      // ONE shared proof rule (photoProofPolicy) — same predicate the payout
      // CTA and completeJob's re-check enforce, same stated reason.
      // `gate`, not `undefined` — the poster's per-job answer
      // (`require_photo_proof`, 2026-09-11) lives on this row and the DB
      // trigger reads it. Passing undefined here demanded photos on a job the
      // poster had excused and the server would have accepted: a dead Done
      // button with a toast explaining a rule that no longer applied.
      const proofJob = { require_photo_proof: gate?.require_photo_proof ?? true };
      const hasPhotos = hasRequiredProof(proofJob, gate?.proof_before_urls, gate?.proof_after_urls);
      if (!hasPhotos) {
        hapticError();
        toast.error(requiredProof(proofJob).reason);
        setUpdating(false);
        return;
      }
      // The 30-minute floor greys the button at render (useDoneFloor); no toast (owner, 2026-10-08).
    }

    const now0 = new Date().toISOString();
    // `arrived` keeps the REASON a fix failed, because it changes what the
    // Helpr is told afterwards ("Location is turned off…" vs "we couldn't get
    // a fix"). It no longer changes WHETHER they check in. Every other step
    // proceeds either way, so it only needs the coordinates.
    const locOutcome = newStatus === "arrived" ? await getLocationOutcome() : null;
    const loc = locOutcome ? ("error" in locOutcome ? null : locOutcome) : await getLocation();

    // "MARK ARRIVED" ALWAYS RECORDS THE CHECK-IN. LOCATION IS EVIDENCE, NOT A
    // DOOR.
    //
    // OWNER, 2026-09-19 (verbatim): "if gps is not on, they can mark themselves
    // as arrived but can not move on until the poster marks them arrived … but
    // even if gps does confirm they are there the poster still needs ro cfnrm
    // wither way".
    //
    // WHAT THIS REPLACED. Under VN-33 (20260915044137) the RPC REFUSED a far or
    // fix-less arrival and wrote nothing, and this branch returned before the
    // tracking row was written — so a Helpr with Location off never got a
    // `helper_arrived_at`, the poster's "Confirm they've arrived" control (gated on
    // exactly that column) never rendered, and the Helpr's blocked CTA told them
    // to go ask the poster for a tap the poster was never offered. A deadlock
    // with a polite explanation on both ends.
    //
    // NOW: no early return on a failed fix. The RPC is called either way —
    // without coordinates when there are none — it stamps `helper_arrived_at`
    // on every call, and it stamps `helper_arrival_verified_at` only when it
    // genuinely measured the Helpr at the job. The verdict says which happened
    // and `arrivalVerdictMessage` turns that into the one sentence the Helpr
    // reads; every branch of it ends on the poster's tap, because that is the
    // only gate left and they have to know it is coming ("they shoud be aware
    // of this so they dont try to cheat the system").
    if (newStatus === "arrived") {
      const { data: verdict, error: arrivalErr } = await supabase.rpc("mark_helper_arrival", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (arrivalErr) {
        const refusal = arrivalRefusalFromError(arrivalErr);
        hapticError();
        if (identityRefusal(arrivalErr) && openIdentityCheck("start")) { setUpdating(false); return; } // Stripe Identity first (20261021081258); a sheet that cannot open (ID check off) falls to the error below
        if (refusal) {
          // LEGACY ONLY — the live RPC raises none of these any more. A queued
          // request answered by the previous definition still can, and it
          // genuinely wrote nothing, so the rail must not advance.
          setArrivalRefusal(refusal);
          toast.warning(arrivalRefusalMessage(refusal), { duration: 9000 });
          setUpdating(false);
          return;
        }
        report(arrivalErr, { tags: { source: "JobTracking.markArrival" } });
        toast.error(
          isMissingRpcNamed(arrivalErr, "mark_helper_arrival") // short window between merge and the auto-deploy landing
            ? "Arrival check-in is updating — try again in a minute."
            : (rpcErrorMessage("mark_helper_arrival", arrivalErr) ?? lifecycleErrorMessage(arrivalErr) ?? "Couldn't mark you arrived — try again?"),
        );
        setUpdating(false);
        loadTracking();
        return;
      }
      // A NULL ERROR IS NOT A WRITE. The RPC returns a jsonb verdict on every
      // success; `arrivalVerdictFromRpc` returns null when the body is absent
      // or unrecognisable, and that means something silently did nothing. It is
      // NOT treated as a success — the rail stays put and the row is re-read.
      const v = arrivalVerdictFromRpc(verdict);
      if (!v) {
        report(new Error("mark_helper_arrival returned no verdict"), {
          tags: { source: "JobTracking.markArrival" },
        });
        hapticError();
        toast.error("Couldn't mark you arrived — try again?");
        setUpdating(false);
        loadTracking();
        return;
      }
      setArrivalRefusal(null);
      applyArrivalVerdict(v);
      // The check-in SUCCEEDED in every one of these branches, so none gets the error haptic or an error toast. An
      // unverified location is an ordinary outcome (Location off, a wrong map pin, a bad fix), not the Helpr's fault:
      // treating it as one is the "accusation" the owner ruled out. Unsettled goes through the bare `toast()` (`toast.info`
      // renders nothing without an action, toastPolicy.ts) so the Helpr learns the poster must confirm (owner,
      // 2026-09-19: "they shoud be aware of this"). Settled, the tracker's next step already says so.
      const settled = v.verified || v.posterConfirmed;
      if (settled) hapticSuccess();
      else toast(arrivalVerdictMessage(v), { duration: 9000 });
    }

    const now = now0;

    // THE MONEY STAMP LANDS BEFORE THE TRACKING ROW SAYS "DONE".
    //
    // This used to run AFTER the job_tracking write, which is the second half
    // of the same defect the gates above fix: a stamp rejected by RLS or by a
    // job that had already moved on still left a persisted `status = 'done'`
    // behind it. `helper_completed_at` is what enters the job into the payout
    // pipeline, so it is the event the tracker is allowed to draw — and it has
    // to be the one that happens first.
    //
    // .select("id"): "silently fails" includes matching zero rows, which
    // returns error === null. Without the row count this stamp could no-op
    // (RLS, a job that already moved on) and the helper would be told the
    // payout clock had started.
    //
    // .in("status", LIVE): the stamp only lands on a job that is still live.
    // Queued behind a poster's cancel (or a release) it used to stamp the
    // cancelled/completed row; now it matches zero rows and says so. The
    // database enforces the same rule (trg_completion_on_live_job,
    // 20260914215112) — this is the client half, so the Helpr gets the honest
    // "already completed or cancelled" message instead of a trigger error.
    //
    // poster_completed_at comes back so a Done that lands AFTER the poster
    // already confirmed finishes the release (below) instead of leaving a job
    // both parties confirmed sitting in_progress.
    if (newStatus === "done") {
      let posterAlreadyConfirmed: boolean | undefined;

      // COMPLETION IS A SERVER DECISION. rpc_helper_mark_done re-runs the
      // assigned-Helpr / live-job / arrival / proof / 30-minute gates and stamps
      // helper_completed_at = now() itself, so a direct PATCH can no longer pick
      // the stamp's VALUE (a backdate makes it instantly auto-releasable) or land
      // it on a job that already moved on (H-001/H-002,
      // enforce_job_completion_server_owned). It returns poster_completed_at so a
      // Done that arrives AFTER the poster already confirmed still finishes the
      // release below.
      //
      // PGRST202 → the short merge→deploy window before the RPC lands (same
      // pattern as helper_mark_on_the_way / mark_helper_arrival). In that window
      // the completion trigger is not live either, so the legacy direct stamp
      // still works and stays the fallback body.
      const { data: doneRes, error: doneRpcErr } = await supabase.rpc("rpc_helper_mark_done", {
        _job_id: jobId,
      });
      if (!doneRpcErr) {
        posterAlreadyConfirmed = !!(doneRes as { poster_completed_at?: string | null } | null | undefined)?.poster_completed_at;
      } else if (isMissingRpcNamed(doneRpcErr, "rpc_helper_mark_done")) {
        try {
          const [stamped] = unwrapMutation(
            await supabase
              .from("jobs")
              .update({ helper_completed_at: now })
              .eq("id", jobId)
              .in("status", ["accepted", "in_progress", "revision_requested"])
              .select("id, poster_completed_at"),
            {
              action: "mark the job complete",
              rejectedMessage: "We couldn't mark this job complete — it may have already been completed or cancelled. Refresh the page.",
              context: { jobId },
            },
          );
          posterAlreadyConfirmed = !!stamped?.poster_completed_at;
        } catch (doneErr) {
          if (!isWriteRejected(doneErr)) {
            report(doneErr, { tags: { source: "JobTracking.helperCompleted" } });
          }
          hapticError();
          toast.error(lifecycleErrorMessage(doneErr) ?? mutationErrorMessage(doneErr, "Couldn't mark the job complete — try again?"));
          setUpdating(false);
          loadTracking();
          return;
        }
      } else {
        // The RPC refused (a completion gate, a live-job race, authz) or errored.
        // Its custom codes get their sentence through rpcErrorMessage; a benign
        // race is not reported (matches the old zero-row path).
        // A3-115: "done" before a day set to finish (continue_day_ahead) is the rule working, not a defect.
        if (!isWriteRejected(doneRpcErr) && !isExpectedLifecycleRefusal(doneRpcErr)) {
          report(doneRpcErr, { tags: { source: "JobTracking.helperCompleted" } });
        }
        hapticError();
        toast.error(
          lifecycleErrorMessage(doneRpcErr)
            ?? rpcErrorMessage("rpc_helper_mark_done", doneRpcErr)
            ?? "Couldn't mark the job complete — try again?",
        );
        setUpdating(false);
        loadTracking();
        return;
      }

      // BOTH SIDES HAVE NOW CONFIRMED — FINISH IT. The poster's release
      // committed first with this Helpr not yet done, so it only stamped
      // poster_completed_at; this plain stamp completes nothing on its own, and
      // the job sat in_progress with both confirmations until the 24h sweep
      // (14/20 PGlite rounds, 20260914215112). create-payment's release treats
      // exactly this shape as "fall through and complete" and runs the Stripe
      // capture check the database cannot. The stamp above stands either way,
      // so a failure here is reported and told, not rolled back.
      if (posterAlreadyConfirmed) {
        const { data: rel, error: relErr } = await supabase.functions.invoke("create-payment", {
          body: { action: "release", jobId },
        });
        if (relErr || (rel as { error?: string } | null)?.error) {
          report(relErr ?? new Error(String((rel as { error?: string }).error)), {
            tags: { source: "JobTracking.finishRelease" },
            context: { jobId },
          });
          toast.warning("Marked done. The person who posted this job already approved, but we couldn't schedule your payout just now. Because they approved, we schedule it for you within the day unless something needs a look. Refresh the page.", { duration: 8000 });
        } else {
          // Q222 analytics + Q2029 success moment (the poster release's beat): true only for a NEW completion, so a replay never plays twice.
          if (trackJobCompleted(jobId, rel as { bothDone?: boolean } | null, "job_tracking", helperId)) fireSuccessMoment({ label: "Job completed" });
        }
      }
    }

    // THE OPTIMISTIC ROW IS REVERTIBLE, because it also leads reality until
    // the write lands. `loadTracking()` on the failure paths below only calls
    // setTracking when the server returns a row — so on the very case that
    // matters (the INSERT branch, where no row exists yet) a rejected write
    // left this `id: "temp"` row in place with the new status on it, and
    // `deriveCurrentStatusIdx` reads `tracking.status` first. Same defect
    // shape as the persisted one the gates above fix, one layer up: nothing
    // may claim a step the server did not accept.
    const trackingBeforeWrite = tracking;
    setTracking(prev => prev ? { ...prev, status: newStatus, latitude: loc?.lat || prev.latitude, longitude: loc?.lng || prev.longitude, updated_at: now } : {
      id: "temp",
      status: newStatus,
      latitude: loc?.lat || null,
      longitude: loc?.lng || null,
      eta_minutes: null,
      updated_at: now,
    });

    // ON THE WAY IS ONE TRANSACTION, NOT THREE WRITES.
    //
    // It used to be three client writes (tracking upsert, jobs.status = in_progress, helper_on_the_way_at); a run
    // interrupted after write #2 left in_progress with NO tracking row or departure stamp (live 2026-08-28, job
    // db21c20d). The RPC does all three atomically, checks the caller is the confirmed helper, and (status + stamp in
    // ONE jobs update) the notify trigger fires once instead of twice.
    //
    // PGRST202 fallback: merge→deploy window for a brand-new RPC (as mark_helper_arrival above); legacy sequence below.
    let onTheWayAtomic = false;
    if (newStatus === "on_the_way") {
      const { error: otwErr } = await supabase.rpc("helper_mark_on_the_way", {
        p_job_id: jobId,
        p_lat: loc?.lat ?? undefined,
        p_lng: loc?.lng ?? undefined,
      });
      if (!otwErr) {
        onTheWayAtomic = true;
        setJobStamps((prev) => ({ ...prev, onTheWayAt: prev.onTheWayAt ?? now }));
      } else if (identityRefusal(otwErr) && openIdentityCheck("start")) {
        // Stripe Identity first (20261021081258): nothing was written; the ID sheet, not a toast.
        hapticError(); setUpdating(false); setTracking(trackingBeforeWrite); return; // a sheet that cannot open falls to the branch below, which reports and toasts
      } else if (!isMissingRpcNamed(otwErr, "helper_mark_on_the_way")) {
        report(otwErr, { tags: { source: "JobTracking.markOnTheWay" } });
        hapticError();
        toast.error(rpcErrorMessage("helper_mark_on_the_way", otwErr) ?? "Couldn't mark you on the way — try again?");
        setUpdating(false);
        setTracking(trackingBeforeWrite);
        loadTracking();
        return;
      }
      // PGRST202 → fall through to the legacy three-write sequence.
    }

    // .select("id") on both branches: the tracking row is the source of truth
    // for the helper's own view, and an update that matches zero rows returns
    // error === null — the card would have kept the optimistic status forever.
    try {
      if (!onTheWayAtomic)
      unwrapMutation(
        tracking && tracking.id !== "temp"
          ? await supabase
              .from("job_tracking")
              .update({
                status: newStatus,
                latitude: loc?.lat || null,
                longitude: loc?.lng || null,
                updated_at: now,
              })
              .eq("id", tracking.id)
              .select("id")
          : await supabase.from("job_tracking").insert({
              job_id: jobId,
              helper_id: helperId,
              status: newStatus,
              latitude: loc?.lat || null,
              longitude: loc?.lng || null,
            }).select("id"),
        {
          action: "update your status",
          rejectedMessage: "We couldn't update your status — this job may have been cancelled. Refresh the page.",
          context: { jobId, newStatus },
        },
      );
    } catch (writeErr) {
      if (!isWriteRejected(writeErr)) {
        report(writeErr, { tags: { source: "JobTracking.updateStatus" } });
      }
      hapticError();
      toast.error(lifecycleErrorMessage(writeErr) ?? mutationErrorMessage(writeErr, "Couldn't update your status — try again?"));
      setUpdating(false);
      setTracking(trackingBeforeWrite);
      loadTracking();
      return;
    }

    // Auto-transition job status
    let statusTransitioned = false;
    // `done` is handled above — its gates run before any write and its
    // `helper_completed_at` stamp lands before the tracking row records it.
    if (["on_the_way", "arrived", "working"].includes(newStatus) && !onTheWayAtomic) {
      const { data: job, error: statusErr } = await supabase.from("jobs").select("status").eq("id", jobId).single();
      if (statusErr) report(statusErr, { tags: { source: "JobTracking.autoTransition" } });
      // These writes used to drop their errors, while the `helper_completed_at`
      // stamp on the `done` path was carefully checked. That asymmetry was the
      // bug: these are the exact columns the POSTER's timeline reads, so on an
      // RLS or network failure the helper got a success buzz (and now a success
      // toast) while the poster's screen never moved — a phantom success on the
      // one signal the poster is waiting for.
      //
      // The tracking row itself is already written and is the source of truth
      // for the helper's own view, so a failure here does not invalidate the
      // action — it just means the poster won't see it. Hence: report, and tell
      // the truth in the toast, rather than aborting the whole transition.
      //
      // .select("id") on both: a zero-row update is the same phantom
      // success as an error here, and is the more likely of the two (RLS on
      // jobs the helper doesn't own, or a job cancelled out from under them).
      const stampErrors: string[] = [];
      const stampJob = async (
        patch: TablesUpdate<"jobs">,
        label: string,
        source: string,
      ) => {
        try {
          unwrapMutation(
            await supabase.from("jobs").update(patch).eq("id", jobId).select("id"),
            { action: `update the ${label} shown to the person who posted this job`, context: { jobId } },
          );
        } catch (err) {
          if (!isWriteRejected(err)) report(err, { tags: { source } });
          stampErrors.push(label);
        }
      };
      if (job && job.status === "accepted") {
        await stampJob({ status: "in_progress" }, "status", "JobTracking.statusInProgress");
        statusTransitioned = true;
      }
      // `helper_arrived_at` is NOT stamped here any more — mark_helper_arrival
      // above wrote it (and the status transition) inside the same transaction
      // that decided whether the arrival was verified. Stamping it a second
      // time from the client would be the only writer able to set it without a
      // proximity verdict attached.
      if (newStatus === "on_the_way") {
        await stampJob({ helper_on_the_way_at: now }, "departure time", "JobTracking.onTheWayAt");
      }
      if (stampErrors.length > 0) {
        hapticError();
        toast.error("Saved for you, but we couldn't update what the person who posted this job sees — check your connection.");
        setUpdating(false);
        loadTracking();
        return;
      }
    }

    // Notify the poster — ONLY when no server-side writer already did.
    //
    // Every transit event used to notify TWICE (proven live 2026-08-28, job
    // db21c20d): the notify_poster_on_status_change DB trigger
    // (20260824070000, kept — it fires even if this client dies mid-flow)
    // AND this block. Per-event server coverage:
    //   - on_the_way : trigger on jobs.helper_on_the_way_at (stamped by the
    //                  helper_mark_on_the_way RPC or the legacy stampJob) →
    //                  client notification REMOVED.
    //   - arrived    : trigger on jobs.helper_arrived_at (stamped by
    //                  mark_helper_arrival) → REMOVED.
    //   - done       : trigger on jobs.helper_completed_at → REMOVED.
    //   - working    : trigger fires only on the accepted→in_progress status
    //                  transition ("Work has started"). When the job is
    //                  ALREADY in_progress (the normal case — on_the_way set
    //                  it) no jobs column changes at the "working" tap, so no
    //                  server writer exists and the client one is KEPT.
    // Link: /posts?filter=scheduled — the old filter=in_progress is not a
    // bucket Activity knows (needs_you/scheduled/waiting/done) and landed on
    // the default list; a poster's in_progress job buckets as "scheduled".
    //
    // The RESULT of that send is checked. It used to be discarded, so a failed
    // read of the job row — or a failed edge-function invoke — meant the
    // poster's only "work has started" signal silently never sent while the
    // helper was told everything was fine. `createNotification` already
    // report()s its own failure, so this only has to tell the person.
    let posterNotified = true;
    if (isHelper && newStatus === "working" && !statusTransitioned) {
      const { data: job, error: notifyErr } = await supabase.from("jobs").select("title, customer_id").eq("id", jobId).single();
      if (notifyErr) report(notifyErr, { tags: { source: "JobTracking.notifyPoster" } });
      if (job?.customer_id) {
        const { notifyJobParty } = await import("@/lib/notifications");
        // Copy and link (`/posts?job=`) are built server-side (Q223).
        const { error: pushErr } = await notifyJobParty({
          user_id: job.customer_id,
          job_id: jobId,
          template: "work_started",
        });
        if (pushErr) posterNotified = false;
      } else {
        // No customer_id in hand (the read failed, or the row is gone) — there
        // is nobody to notify, which is the same outcome as a failed send.
        posterNotified = false;
      }
    }

    hapticSuccess();
    // SAY SOMETHING. Every transition used to fire haptics and nothing else,
    // so on the web — and on any phone with haptics off — a successful tap gave
    // no feedback at all. The tracker row moves, but it is one small step in a
    // scrolling line and easy to miss on the very tap that matters most.
    if (!posterNotified) {
      toast.warning("Work started — we saved it, but couldn't tell the person who posted this job. Send them a message so they know.");
    } else {
      // `arrived` has no entry in the map on purpose — see TRANSITION_TOAST.
      const message = TRANSITION_TOAST[newStatus];
      if (message) announceTransition(newStatus, message, { jobId, at: now });
    }
    setUpdating(false);
    loadTracking();
  };
  return runStatusUpdate;
}
