import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Banknote } from "lucide-react";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { formatShortDate, formatPriceExact } from "@/lib/format";
import { unwrap } from "@/lib/supabaseResult";
import { cn } from "@/lib/utils";
import { toneBadgeClasses } from "@/components/admin/tones";

/**
 * Disputes whose DECISION is committed but whose MONEY never moved.
 *
 * `rpc_decide_dispute` records the decision, flips the job off 'disputed' and
 * notifies both parties; the client only then invokes `execute-dispute-split`.
 * Every way that call can fail leaves a job the console calls resolved and an
 * escrow nobody has touched. Before this card those cases were in no queue:
 * the dispute queue no longer matched them (the job is not 'disputed') and the
 * Exception Queue only ever covered verification.
 *
 * Read-only on purpose. Retrying a settlement moves real money and belongs on
 * the dispute card, next to the decision it is executing — this is the alarm,
 * not the switch.
 */
interface UnsettledRow {
  id: string;
  job_id: string;
  decided_at: string | null;
  execution_status: string | null;
  execution_error: string | null;
  jobs: { title: string | null; budget: number | null; payment_status: string | null } | null;
}

export const UnsettledSettlements = () => {
  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<UnsettledRow[]>({
    key: ["admin-unsettled-settlements"],
    fallback: [],
    fetcher: async () => {
      const res = await (supabase.from as any)("disputes")
        .select("id, job_id, decided_at, execution_status, execution_error, jobs:job_id ( title, budget, payment_status )")
        .eq("status", "decided")
        // NULL is admitted alongside 'pending': `execution_status <> 'executed'`
        // is NULL-blind in SQL, and a legacy row that the 20260907194838
        // backfill has not reached is exactly the row this card exists for.
        .or("execution_status.is.null,execution_status.neq.executed")
        .order("decided_at", { ascending: true });
      // 42703 / PGRST205 = the execution columns aren't deployed yet. That is a
      // genuine "nothing to show", unlike every other failure — which must
      // throw, because an empty money-alarm that failed to load is a lie.
      if (res.error && ["42703", "PGRST205", "42P01"].includes((res.error as { code?: string }).code ?? "")) {
        return [];
      }
      return (unwrap(res) ?? []) as UnsettledRow[];
    },
  });

  if (isInitialLoading) return null;
  // Nothing stuck is the normal case — say so briefly rather than occupying the
  // top of the screen with an empty alarm.
  if (!isError && rows.length === 0) {
    return (
      <AdminCard title="Unsettled Settlements">
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={Banknote}
          title="Every decided dispute has settled"
          body="No escrow is sitting behind a decision that already went out to both parties."
        />
      </AdminCard>
    );
  }

  const stuckDollars = rows.reduce((sum, r) => sum + Number(r.jobs?.budget ?? 0), 0);

  return (
    <AdminCard
      title="Unsettled Settlements"
      subtitle="A decision was recorded and both parties were told — but the escrow has not moved. Retry each one from the Disputes queue."
      action={
        rows.length > 0 ? (
          <span className={cn("inline-flex items-center justify-center rounded-full text-ds-11 font-bold px-2.5 py-1", toneBadgeClasses.danger)}>
            ${formatPriceExact(stuckDollars)} stuck
          </span>
        ) : undefined
      }
      contentClassName="space-y-3"
    >
      {isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't check for unsettled settlements."
          body="Tap Try again. This list is read straight from the disputes table — an error here means unknown, not clear."
          onRetry={() => refetch()}
        />
      ) : (
        rows.map((r) => (
          <div key={r.id} className="rounded-ds-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-ds-13 text-foreground min-w-0 truncate">
                {r.jobs?.title ?? "Untitled job"}
              </p>
              <span className="shrink-0 inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3" /> {r.execution_status ?? "pending"}
              </span>
            </div>
            <p className="text-ds-11 text-muted-foreground tabular-nums">
              ${formatPriceExact(Number(r.jobs?.budget ?? 0))} · escrow {r.jobs?.payment_status ?? "unknown"}
              {r.decided_at ? ` · decided ${formatShortDate(r.decided_at)}` : ""}
            </p>
            {r.execution_error && (
              <p className="text-ds-11 text-destructive">{r.execution_error}</p>
            )}
            <p className="text-ds-10 text-muted-foreground break-all">
              dispute {r.id} · job {r.job_id}
            </p>
          </div>
        ))
      )}
    </AdminCard>
  );
};
