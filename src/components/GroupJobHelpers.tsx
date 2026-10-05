import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { XCircle } from "lucide-react";
import { toast } from "sonner";
import { applicationStatusLabel } from "@/lib/statusLabels";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { JobActionChip } from "@/components/job-card/JobActionRow";
import { CrewActionError, crewMemberStatusLabel, posterConfirmMemberArrival } from "@/lib/crewLifecycle";

/** Label for a roster slot whose helper has deleted their account.
 *
 * NOT "Helpr". `helper_id` went nullable in 20260902014651: account deletion
 * severs the identity but KEEPS the row, because the roster is the poster's
 * record of who worked a completed job. So a null here is a real, permanent
 * state, not a failed lookup — and the previous `|| "Helpr"` fallback rendered
 * it identically to a member whose profile read merely errored, which is the
 * one thing the poster must not confuse it with: one of those people can still
 * be messaged and paid, and the other cannot. */

type GroupHelper = {
  id: string;
  /** NULL once this member deletes their account — the slot is retained, the
      identity is severed. See FORMER_MEMBER_LABEL. */
  helper_id: string | null;
  status: string;
  helperName?: string;
  /* This member's own lifecycle stamps (Q1382). Optional: a caller that did
     not select them gets the hire status pill and no arrival control. */
  helper_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  helper_completed_at?: string | null;
};

export function GroupJobHelpers({
  jobId,
  helpersNeeded,
  isOwner,
  jobStatus,
  initialHelpers,
}: {
  jobId: string;
  helpersNeeded: number;
  isOwner: boolean;
  /**
   * `jobs.status`. Removal is only offered while the crew is still being
   * assembled ('open'), which is the same window the DELETE policy allows —
   * see the note on `canRemove` below. Omitting it hides removal entirely
   * rather than rendering a control that will be refused.
   */
  jobStatus?: string | null;
  /**
   * Optional pre-fetched group-helper rows for this job. When provided
   * (including an empty array), the per-card initial 2-query waterfall
   * (group_job_helpers + profiles) is skipped — the parent has already
   * batched-fetched group helpers across every active group-job card on
   * the page. `undefined` (the default) falls back to the legacy
   * per-mount fetch for callers outside the Activity surface.
   */
  initialHelpers?: GroupHelper[];
}) {
  // Seed from the parent-batched rows when present so we don't fire two
  // queries per group-job card on every Activity render.
  const [helpers, setHelpers] = useState<GroupHelper[]>(initialHelpers ?? []);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<GroupHelper | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Only fall back to a per-card fetch when the parent did NOT supply
    // pre-fetched data. Activity surfaces always supply it (even as an
    // empty array meaning "no rows yet"), so the initial round-trip is
    // eliminated.
    if (initialHelpers === undefined) loadHelpers();
    // `initialHelpers` is read once on mount to decide whether to skip
    // the fallback fetch. Live updates flow through the sync-effect
    // below, not here.
  }, [jobId]);

  // Keep local helpers in sync when the parent re-supplies a fresh
  // batch — e.g. after the activity cache invalidates and refetches.
  useEffect(() => {
    if (initialHelpers !== undefined) setHelpers(initialHelpers);
  }, [initialHelpers]);

  const loadHelpers = async () => {
    const { data, error } = await supabase
      .from("group_job_helpers")
      .select("*")
      .eq("job_id", jobId);
    if (error) {
      console.error("[GroupJobHelpers] failed to load group helpers:", error);
      report(error, { severity: "warning", tags: { source: "GroupJobHelpers.load" } });
      toast.error("Couldn't load group Helprs.");
      return;
    }
    const rows = (data ?? []) as unknown as GroupHelper[];
    if (rows.length > 0) {
      // Drop the departed members before building the `.in()` list — a null in
      // a PostgREST `in.(...)` list is not "match nothing", it is a malformed
      // filter, and there is no profile to find for them anyway.
      const helperIds = rows.map((h) => h.helper_id).filter((id): id is string => !!id);
      const { data: profiles, error: profilesError } = helperIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", helperIds)
        : { data: [], error: null };
      if (profilesError) {
        console.error("[GroupJobHelpers] failed to load helper profiles:", profilesError);
        report(profilesError, { severity: "warning", tags: { source: "GroupJobHelpers.profiles" } });
      }
      const nameMap = new Map(profiles?.map((p) => [p.user_id, formatName(p.full_name, "Helpr")]) || []);
      setHelpers(
        rows.map((h) => ({
          ...h,
          helperName: h.helper_id
            ? nameMap.get(h.helper_id) || "Helpr"
            : FORMER_MEMBER_LABEL,
        }))
      );
    } else {
      setHelpers([]);
    }
  };

  /**
   * Removal is only possible while the crew is still being assembled.
   *
   * The DELETE policy added in 20260901030422 requires `jobs.status = 'open'`,
   * which is exactly the window `accept_group_application` holds the job in
   * until the final slot fills. After that the job is a live commitment with
   * escrow behind it and a Helpr who has arranged their day around it —
   * dropping them is a cancellation that owes them notice and a fee
   * settlement, not a row delete. Rendering the control past that point would
   * be a button the server refuses on every tap, which is what this component
   * shipped with: there was no DELETE policy at all, so every removal matched
   * zero rows, forever.
   */
  const canRemove = isOwner && jobStatus === "open";

  /**
   * THE POSTER'S PER-MEMBER "Confirm They Arrived" (Q1382). A crew has no lead
   * (Q407): each member's arrival is confirmed on their own roster row by
   * rpc_poster_confirm_member_arrival, and that confirmation is the gate the
   * server enforces before that member can mark their part done
   * (enforce_group_member_completion_gates). Offered only for a member who has
   * checked in and is not confirmed yet, on a job in a state the RPC admits.
   */
  const arrivalConfirmable = (h: GroupHelper) =>
    isOwner &&
    !!h.helper_id &&
    !!h.helper_arrived_at &&
    !h.poster_confirmed_arrival_at &&
    (jobStatus === "accepted" || jobStatus === "in_progress" || jobStatus === "revision_requested");

  const confirmArrival = async (h: GroupHelper) => {
    if (!h.helper_id || confirmingId) return;
    setConfirmingId(h.id);
    try {
      const stamp = await posterConfirmMemberArrival(jobId, h.helper_id);
      setHelpers((prev) => prev.map((x) => (x.id === h.id ? { ...x, poster_confirmed_arrival_at: stamp } : x)));
      hapticSuccess();
      toast.success(`${h.helperName || "Your Helpr"} is confirmed on site.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
    } catch (err) {
      hapticError();
      const copy = err instanceof CrewActionError ? err.copy : null;
      if (!copy) {
        report(err instanceof CrewActionError ? err.original ?? err : err, {
          tags: { source: "GroupJobHelpers.confirmArrival" },
        });
      }
      toast.error(copy ?? "Couldn't confirm that arrival. Please try again.");
      if (initialHelpers === undefined) void loadHelpers();
      else void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
    } finally {
      setConfirmingId(null);
    }
  };

  const removeHelper = async (id: string) => {
    if (removingIds.has(id)) return;
    const removed = helpers.find((h) => h.id === id);
    setRemovingIds((prev) => new Set(prev).add(id));
    // Optimistically drop the helper so the UI updates on tap.
    setHelpers((prev) => prev.filter((h) => h.id !== id));

    // `.select("id")` because a DELETE that matches zero rows is
    // `{ data: [], error: null }`. The row was dropped from the list
    // optimistically above, so without the row count an RLS refusal or a stale
    // id left the poster looking at a crew of two while a third Helpr was
    // still assigned to the job — and still expecting to be paid for it.
    let failure: unknown = null;
    try {
      unwrapMutation(
        await supabase.from("group_job_helpers").delete().eq("id", id).select("id"),
        {
          action: "remove this Helpr from the job",
          rejectedMessage: "That Helpr wasn't removed — they may have already been taken off.",
          context: { job_id: jobId, group_job_helper_id: id },
        },
      );
    } catch (err) {
      failure = err;
    }

    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (failure) {
      console.error("[GroupJobHelpers] failed to remove helper:", failure);
      // unwrapMutation already reported a zero-row rejection; this covers the
      // transport / RLS error it rethrows unreported.
      if (!isWriteRejected(failure)) {
        report(failure, { tags: { source: "GroupJobHelpers.remove" } });
      }
      toast.error(mutationErrorMessage(failure, "Couldn't remove Helpr."));
      // Revert: re-add the removed helper, or reload if we lost the snapshot.
      if (removed) {
        setHelpers((prev) => (prev.some((h) => h.id === id) ? prev : [...prev, removed]));
      } else {
        loadHelpers();
      }
      return;
    }

    // Tell them. Being dropped from a crew you accepted is the single event in
    // this component the other party most needs to know about, and it was the
    // only lifecycle change in the whole group flow that notified nobody — the
    // Helpr's Activity tab would simply stop listing a job they had planned
    // their day around. Best-effort: the removal itself has already succeeded,
    // so a failed notify must not roll it back or claim the removal failed.
    // `removed.helper_id` is null when the slot's helper has deleted their
    // account. There is nobody to tell, and `notifications.user_id` is NOT
    // NULL, so inserting anyway is a guaranteed 23502 reported as a warning on
    // a removal that actually succeeded.
    if (removed?.helper_id) {
      const { error: notifyError } = await supabase.from("notifications").insert({
        user_id: removed.helper_id,
        title: "You're no longer on this group job",
        message: "The person who posted this job is still putting this crew together and has taken you off it. You haven't been charged and nothing is owed.",
        type: "job_updates",
        link: `/jobs?job=${jobId}`,
      });
      if (notifyError) {
        console.error("[GroupJobHelpers] removal notification failed:", notifyError);
        report(notifyError, { severity: "warning", tags: { source: "GroupJobHelpers.removeNotify" } });
      }
    }
  };

  // `status === "accepted"` is the roster's DEFAULT, so every row counts unless
  // something has explicitly moved it. `helpersNeeded` is poster-supplied and
  // has been null/0 on legacy rows: guard the divisor or the progress bar's
  // width becomes `Infinity%`/`NaN%` and the caption reads "-1 more Helprs".
  const slotTotal = Math.max(1, Math.floor(helpersNeeded) || 1);
  const filledSlots = helpers.filter((h) => h.status === "accepted").length;
  const remaining = Math.max(0, slotTotal - filledSlots);

  return (
    /* FLAT, like the poster tracker (6e3d2f7d1) and HelperTrackerPanel
       (owner-approved 2026-09-14). The only caller renders this inside
       PostedJobCard's JobCardShell, which is already the glass card; the
       `rounded-2xl liquid-glass p-card` wrapper drew a bordered box inside it.
       Guard: src/test/noNestedTrackerCard.test.ts (cross-file job-card walk). */
    <div className="space-y-3">
      <div>
        <h3
          className="font-display italic font-bold leading-tight text-headline-card"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          Group job
        </h3>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${Math.min(100, (filledSlots / slotTotal) * 100)}%` }}
          />
        </div>
        <span className="text-ds-11 font-medium text-foreground">
          {filledSlots}/{slotTotal} Helprs
        </span>
      </div>

      {helpers.length > 0 && (
        <div className="space-y-2">
          {helpers.map((h) => (
            <div key={h.id} className="flex items-center justify-between p-2 rounded-ds-sm border border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-ds-11 font-bold">
                  {(h.helperName || "?")[0].toUpperCase()}
                </div>
                <span className="text-ds-13 text-foreground">{h.helperName}</span>
                <span className={`text-ds-11 px-1.5 py-0.5 rounded-full ${
                  h.status === "accepted" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                }`}>
                  {h.status === "accepted" && h.helper_confirmed_at !== undefined
                    ? crewMemberStatusLabel({
                        helper_confirmed_at: h.helper_confirmed_at ?? null,
                        helper_on_the_way_at: h.helper_on_the_way_at ?? null,
                        helper_arrived_at: h.helper_arrived_at ?? null,
                        poster_confirmed_arrival_at: h.poster_confirmed_arrival_at ?? null,
                        helper_completed_at: h.helper_completed_at ?? null,
                      })
                    : applicationStatusLabel(h.status)}
                </span>
              </div>
              {arrivalConfirmable(h) && (
                <div className="shrink-0">
                  <JobActionChip
                    icon={MapPin}
                    label={confirmingId === h.id ? "Confirming…" : "Confirm Arrived"}
                    ariaLabel={`Confirm ${h.helperName || "this Helpr"} arrived`}
                    tone="primary"
                    disabled={confirmingId !== null}
                    onClick={() => void confirmArrival(h)}
                  />
                </div>
              )}
              {canRemove && (
                // 44px target (Apple HIG) with a negative inset so the row's
                // visual rhythm is unchanged — the bare 16px icon was a
                // quarter of the minimum and sat next to a status pill.
                // Confirm first: this drops a Helpr who has already accepted.
                <button
                  type="button"
                  onClick={() => setPendingRemoval(h)}
                  disabled={removingIds.has(h.id)}
                  aria-label={`Remove ${h.helperName || "Helpr"} from this job`}
                  className="-m-2.5 p-2.5 shrink-0 inline-flex items-center justify-center rounded-full transition-colors disabled:opacity-40"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {remaining > 0 && (
        <p className="text-ds-11 text-muted-foreground text-center">
          {remaining} more Helpr{remaining > 1 ? "s" : ""} needed
        </p>
      )}

      <BrandConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(next) => { if (!next) setPendingRemoval(null); }}
        title="Remove this Helpr?"
        description={
          <>
            {pendingRemoval?.helperName || "This Helpr"} accepted this job and is
            holding the date. Removing them frees the slot for someone else and
            lets them know straight away.
          </>
        }
        primaryLabel="Remove Helpr"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          const target = pendingRemoval;
          setPendingRemoval(null);
          if (target) void removeHelper(target.id);
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
