import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, CloudOff, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import SectionBoundary from "@/components/SectionBoundary";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { toneBadgeClasses } from "@/components/admin/tones";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { logAdminAction } from "@/lib/adminAudit";
import { userFacingError } from "@/lib/userFacingError";
import { formatPriceExact, formatShortDate, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import {
  awaitingHuman,
  isMissingRpc,
  stageLadder,
  stuckLabel,
  STALLED_NO_MONEY_NOTE,
  type StalledQueueRow,
} from "@/components/admin/adminStalledJobs/stalledQueue";

/**
 * STUCK JOBS — the human half of the stalled-completion sweep.
 *
 * `20260919143637_stalled_completion_nudges.sql` shipped the whole server side
 * of this: the nudge ladder, the escalation, `admin_stalled_job_queue()` and
 * `resolve_stalled_job_flag()`. It shipped with NO call site in `src/`, so the
 * only trace of an escalation an admin could see was an `admin_alert`
 * notification and a Slack line — an alert that scrolls away, asking for a
 * decision about held escrow. This is the screen it was escalating to.
 *
 * Modelled on the Exception Queue (`AdminExceptionQueue.tsx`) rung for rung:
 * `SectionBoundary` → `AdminViewShell` → one `AdminCard` with a count chip in
 * its header action, `HelprSpinner` while the first load runs, `ErrorState` and
 * `EmptyState` flattened with `NESTED_EMPTY_SURFACE`, and bordered rows inside.
 * The money-alarm framing of the rows (destructive border, the amount and
 * `payment_status` on one line) is `UnsettledSettlements`', because that card
 * answers the same question this one does: whose money is sitting still.
 *
 * WHAT IT WILL NOT DO. It moves no money — see `STALLED_NO_MONEY_NOTE`. The
 * owner's rule is that a stalled job's escrow is released or refunded only by a
 * person going through the job's own dispute path, where the confirmation names
 * the amount and the recipient. "Mark Reviewed" writes `resolved_at` /
 * `resolved_by` and nothing else.
 */

/** What one fetch of the queue produced, including "I could not ask". */
interface QueueState {
  /** False while `admin_stalled_job_queue` is not on prod yet (PGRST202). */
  deployed: boolean;
  rows: StalledQueueRow[];
  /** user_id → display name, hydrated separately (the RPC returns ids). */
  names: Record<string, string>;
}

const EMPTY_STATE: QueueState = { deployed: true, rows: [], names: {} };

const StalledJobsInner = () => {
  const qc = useQueryClient();
  const [includeResolved, setIncludeResolved] = useState(false);
  const queryKey = ["admin-stalled-job-queue", includeResolved];

  const { data, isInitialLoading, isError, refetch } = useInstantQuery<QueueState>({
    key: queryKey,
    fallback: EMPTY_STATE,
    fetcher: async () => {
      // `admin_stalled_job_queue` ships in the migration this screen was built
      // for, so the generated `Functions` block does not describe it. The cast
      // is exactly as wide as that gap and no wider —
      // `rpcCastsOnDeclaredRpcs.test.ts` turns red the moment types.ts learns
      // the name, which is when it must come out.
      const res = await (supabase.rpc as any)("admin_stalled_job_queue", {
        p_include_resolved: includeResolved,
      });

      // The ONE failure that is not a failure: the RPC is not deployed yet.
      // Returned as a state, never as an empty list — a blank "nothing is
      // stuck" on a screen about held escrow is the lie this codebase keeps
      // paying for (see the Exception Queue's PGRST200 note).
      if (res.error && isMissingRpc(res.error)) {
        return { ...EMPTY_STATE, deployed: false };
      }

      // Anything else throws, which flips the query to `isError` and renders
      // ErrorState. Never drop the `error` half (CLAUDE.md).
      const rows = (unwrap(res) ?? []) as StalledQueueRow[];

      // The RPC returns ids; a human deciding about someone's money needs the
      // names. No FK to embed on (the RPC is a function, not a view), so this
      // is a flat second read — the AdminExceptionQueue pattern.
      const ids = [
        ...new Set(rows.flatMap((r) => [r.customer_id, r.helper_id]).filter(Boolean) as string[]),
      ];
      const names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profs, error: profsError } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        // A failed name lookup must not blank a queue of held escrow, but it
        // must not pass silently either: every row would render its fallback
        // label and look like real data.
        if (profsError) {
          report(profsError, {
            severity: "warning",
            tags: { source: "AdminStalledJobs.hydrateNames" },
          });
        }
        (profs ?? []).forEach((p: { user_id: string; full_name: string | null }) => {
          if (p.full_name) names[p.user_id] = p.full_name;
        });
      }

      return { deployed: true, rows, names };
    },
  });

  /**
   * Same-frame double-tap guard, the house pattern (`ManualVerifyDialog`,
   * `adminDialogsInFlight.test.tsx`): `busy` is state, so two clicks dispatched
   * before a re-render both read it as free. The ref is written synchronously,
   * so the second one sees the first. Keyed by job id — resolving one row must
   * not lock the rest of the queue.
   */
  const inFlight = useRef<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const markReviewed = async (row: StalledQueueRow) => {
    if (inFlight.current.has(row.job_id)) return;
    inFlight.current.add(row.job_id);
    setBusyId(row.job_id);
    try {
      // Same cast, same reason as the queue read above.
      const res = await (supabase.rpc as any)("resolve_stalled_job_flag", {
        p_job_id: row.job_id,
      });
      if (res.error && isMissingRpc(res.error)) {
        toast.error("This queue's functions aren't deployed yet — nothing was recorded.");
        return;
      }
      // `unwrap` throws the real error; a boolean comes back otherwise.
      //
      // The RPC is the row-count check that `unwrapMutation` performs for a
      // table write: it runs the UPDATE with `escalated_at IS NOT NULL AND
      // resolved_at IS NULL` and returns whether it matched. `false` is not an
      // error and must not be reported as success — it means somebody else
      // cleared this one first, which is exactly what a second tap produces.
      const changed = unwrap(res) === true;
      if (!changed) {
        toast("Already cleared — someone got to this one first.");
      } else {
        await logAdminAction("resolve_stalled_job_flag", "job", row.job_id, {
          escalated_at: row.escalated_at,
          payment_status: row.payment_status,
          budget: row.budget,
        });
        toast.success("Marked reviewed. The escrow is untouched.");
      }
      qc.invalidateQueries({ queryKey: ["admin-stalled-job-queue"] });
    } catch (err) {
      report(err, { tags: { source: "AdminStalledJobs.markReviewed" } });
      toast.error(userFacingError(err, "Couldn't record that review — try again."));
    } finally {
      inFlight.current.delete(row.job_id);
      setBusyId((current) => (current === row.job_id ? null : current));
    }
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <HelprSpinner size={24} />
      </div>
    );
  }

  const open = awaitingHuman(data.rows);

  return (
    <AdminViewShell>
      <AdminCard
        title="Jobs Awaiting a Decision"
        subtitle={STALLED_NO_MONEY_NOTE}
        action={
          open.length > 0 ? (
            <span
              className={cn(
                "inline-flex items-center justify-center rounded-full text-ds-11 font-bold px-2.5 py-1 min-w-[1.75rem]",
                toneBadgeClasses.danger,
              )}
            >
              {open.length}
            </span>
          ) : undefined
        }
        contentClassName="space-y-4"
      >
        {/* The shared "pick one of N" control, so this filter wears the same
            olive gloss as every other one in the product — never a hand-rolled
            chip row with its own selected colour. */}
        <SegmentedControl
          ariaLabel="Which stuck jobs to show"
          layout="wrap"
          className="w-fit"
          options={[
            { value: "open", label: "Awaiting a human" },
            { value: "all", label: "Including resolved" },
          ]}
          value={includeResolved ? "all" : "open"}
          onChange={(next) => setIncludeResolved(next === "all")}
        />

        {isError ? (
          <ErrorState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            title="We couldn't load the stuck-job queue."
            body="Tap Try again. An error here means unknown, not clear — escrow may still be held on jobs nobody has marked done."
            onRetry={() => refetch()}
          />
        ) : !data.deployed ? (
          /* The deploy-lag window, said out loud. `db-deploy` runs the
             migration on merge to main; until it has, PostgREST has no
             `admin_stalled_job_queue` to call. */
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={CloudOff}
            title="This queue isn't live yet"
            body="The stalled-job functions ship with migration 20260919143637 and reach the database when db-deploy runs on merge. Until then this screen can't read the queue — it is not saying the queue is empty."
            action={
              <Button size="sm" onClick={() => refetch()}>
                Check again
              </Button>
            }
          />
        ) : data.rows.length === 0 ? (
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={CheckCircle2}
            title={includeResolved ? "Nothing has ever been escalated" : "No jobs are stuck"}
            body={
              includeResolved
                ? "No job has reached 48 hours past its scheduled end with nobody marking it done."
                : "Every escalated job has been looked at. Switch to Including resolved to see the ones that were."
            }
          />
        ) : (
          <div className="space-y-3">
            {data.rows.map((row) => (
              <StalledJobRow
                key={row.job_id}
                row={row}
                names={data.names}
                busy={busyId === row.job_id}
                onMarkReviewed={markReviewed}
              />
            ))}
          </div>
        )}
      </AdminCard>
    </AdminViewShell>
  );
};

/**
 * One row, carrying everything a person needs to decide WITHOUT leaving this
 * screen: what the job was, who both parties are (each linked), how much is
 * held and in what payment state, how far past its scheduled end it is, which
 * nudges actually went out and when, and a link to the job itself.
 *
 * Exported for the unit test, which renders it directly.
 */
export const StalledJobRow = ({
  row,
  names,
  busy,
  onMarkReviewed,
}: {
  row: StalledQueueRow;
  names: Record<string, string>;
  busy: boolean;
  onMarkReviewed: (row: StalledQueueRow) => void;
}) => {
  const resolved = !!row.resolved_at;
  // A job can outlive its poster: deletion nulls `customer_id` (CLAUDE.md), so
  // neither id is assumed present and neither renders an empty link.
  const poster = row.customer_id ? names[row.customer_id] ?? "Unknown" : "Account deleted";
  const helper = row.helper_id ? names[row.helper_id] ?? "Unknown" : "No Helpr on record";

  return (
    <div
      className={cn(
        "rounded-ds-md border p-4 space-y-3",
        resolved ? "border-border/60 bg-background/40" : "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground text-ds-13 min-w-0">
              {row.title ?? "Untitled job"}
            </h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ds-10 font-semibold uppercase tracking-wide",
                resolved ? toneBadgeClasses.success : toneBadgeClasses.danger,
              )}
            >
              {resolved ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> Reviewed
                </>
              ) : (
                <>
                  <AlarmClock className="w-3 h-3" /> Awaiting a human
                </>
              )}
            </span>
          </div>
          <p className="text-ds-11 text-muted-foreground tabular-nums">
            ${formatPriceExact(Number(row.budget ?? 0))} held · payment{" "}
            {row.payment_status ?? "unknown"} · job {row.status ?? "unknown"}
          </p>
          <p className="text-ds-11 font-semibold text-destructive">{stuckLabel(row)}</p>
        </div>

        {/* The action, and the ONLY one. Not a money control — see the card
            subtitle and `STALLED_NO_MONEY_NOTE`. */}
        {!resolved && (
          <Button size="sm" disabled={busy} onClick={() => onMarkReviewed(row)}>
            {busy ? "Recording…" : "Mark Reviewed"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ds-11">
        <span className="text-muted-foreground">
          Posted by{" "}
          {row.customer_id ? (
            <Link to={`/user/${row.customer_id}`} className="font-semibold text-foreground underline underline-offset-2">
              {poster}
            </Link>
          ) : (
            <span className="font-semibold text-foreground">{poster}</span>
          )}
        </span>
        <span className="text-muted-foreground">
          Helpr{" "}
          {row.helper_id ? (
            <Link to={`/user/${row.helper_id}`} className="font-semibold text-foreground underline underline-offset-2">
              {helper}
            </Link>
          ) : (
            <span className="font-semibold text-foreground">{helper}</span>
          )}
        </span>
        <Link
          to={`/jobs/${row.job_id}`}
          className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-2"
        >
          Open the job <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>

      {/* The ladder. "Reminded twice and still nothing" is the difference
          between a decision an admin can make and a guess. */}
      <ul className="space-y-0.5">
        {stageLadder(row).map((stage) => (
          <li key={stage.key} className="text-ds-11 text-muted-foreground">
            <span className="font-semibold text-foreground">+{stage.atHours}h</span> {stage.label} —{" "}
            {stage.sentAt ? formatTimestamp(stage.sentAt) : "not sent"}
          </li>
        ))}
        {row.date_needed && (
          <li className="text-ds-11 text-muted-foreground">
            Scheduled for {formatShortDate(row.date_needed)}
            {/* ONE rule for "when" (src/lib/jobDate.ts) — the same one the
                helper-facing card and detail sheet use, so an admin reading a
                stalled job sees the hour in the form the two parties saw it.
                This printed the RAW column (`14:30`); `jobStartTimeLabel`
                answers "2:30 PM", or null (nothing) when there is no time. The
                stalled-queue row carries no `is_flexible_schedule`, so the
                flexible case simply cannot be claimed here — which is the safe
                direction: it omits rather than invents. */}
            {jobStartTimeLabel(row.start_time) ? ` at ${jobStartTimeLabel(row.start_time)}` : ""}
            {row.estimated_hours ? ` · ~${row.estimated_hours}h of work` : ""}
          </li>
        )}
        {resolved && (
          <li className="text-ds-11 text-muted-foreground">
            Reviewed {formatTimestamp(row.resolved_at)}
          </li>
        )}
      </ul>

      <p className="text-ds-10 text-muted-foreground break-all">job {row.job_id}</p>
    </div>
  );
};

const AdminStalledJobs = () => (
  <SectionBoundary label="the stuck-job queue">
    <StalledJobsInner />
  </SectionBoundary>
);

export default AdminStalledJobs;
