import { useState } from "react";
import { toast } from "sonner";
import { CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { requireBiometric } from "@/lib/biometricGate";
import { confirmConsequential } from "@/lib/toastPolicy";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";

/** The server's reason floor (rpc_admin_end_recurring_series, 20261012194707). */
export const END_SERIES_REASON_MIN = 10;

/** A recurring series, or one visit of one: the RPC ends the series either belongs to. */
export function isSeriesJob(job: { recurrence_days?: number[] | null; parent_job_id?: string | null }): boolean {
  return (Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0) || !!job.parent_job_id;
}

/**
 * Offer the end only where it can still do something: a series PARENT that is
 * cancelled has ended already (the RPC would answer already_ended, dated with
 * the series' start). A visit's own status says nothing about its series.
 */
export function offersSeriesEnd(job: { recurrence_days?: number[] | null; parent_job_id?: string | null; status?: string | null }): boolean {
  if (!isSeriesJob(job)) return false;
  return !(job.parent_job_id == null && job.status === "cancelled");
}

/** What the admin is told after the RPC answers (its jsonb: action, ended_on, booked_visits_remaining). */
export function endSeriesResultMessage(result: unknown): string {
  const r = (result ?? {}) as { action?: string; ended_on?: string | null; booked_visits_remaining?: number | null };
  const booked = Number(r.booked_visits_remaining ?? 0);
  const bookedNote = booked > 0
    ? ` ${booked} visit${booked === 1 ? "" : "s"} already booked still go${booked === 1 ? "es" : ""} ahead unless cancelled.`
    : "";
  if (r.action === "already_ended") return `This series had already ended${r.ended_on ? ` (${r.ended_on})` : ""}. Nothing changed.${bookedNote}`;
  return `Series ended. No new visits will be booked or charged; the poster and the Helprs booked on it were told.${bookedNote}`;
}

/**
 * Q417 (c): the admin half of ending a recurring series. The server half is
 * rpc_admin_end_recurring_series (20261012194707): admin only, never a party to
 * the series, a reason of 10+ characters in admin_audit_log, idempotent
 * (already_ended). It ends the series the job belongs to, exactly as the
 * poster's own end does, tells the poster and every Helpr, and a paid visit
 * nobody is booked on is refunded less the card fee (owner 2026-10-14: never
 * absorb a fee; 20261014084428). Behind the biometric gate every money-adjacent
 * admin action has.
 */
export function EndSeriesSection({ job }: { job: { id: string; recurrence_days?: number[] | null; parent_job_id?: string | null; status?: string | null } }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!offersSeriesEnd(job)) return null;

  const endSeries = async () => {
    // Busy BEFORE the prompt: a second press while it is open sends nothing.
    if (busy) return;
    setBusy(true);
    const ok = await requireBiometric("Confirm ending this recurring series");
    if (!ok) {
      setBusy(false);
      return;
    }
    try {
      const { data, error } = await supabase.rpc("rpc_admin_end_recurring_series", { p_job_id: job.id, p_reason: reason.trim() });
      if (error) {
        report(error, { tags: { source: "AdminJobs.endSeries" } });
        toast.error(rpcErrorMessage("rpc_admin_end_recurring_series", error) ?? userFacingError(error, "Couldn't end that series — nothing changed; try again."));
        return;
      }
      // The RPC answers {action: 'ended' | 'already_ended'}; anything else is
      // not a confirmed end, so it is never shown as one.
      const action = (data as { action?: string } | null)?.action;
      if (action !== "ended" && action !== "already_ended") {
        report(new Error(`rpc_admin_end_recurring_series answered ${JSON.stringify(data)}`), { tags: { source: "AdminJobs.endSeries" } });
        toast.error("The server did not confirm the series ended. Refresh the job and check before trying again.");
        return;
      }
      confirmConsequential(endSeriesResultMessage(data));
      setReason("");
    } catch (err: unknown) {
      // A thrown call never reached the RPC's refusals: say so, and report it.
      report(err, { tags: { source: "AdminJobs.endSeries" } });
      toast.error(userFacingError(err, "Couldn't end that series — try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-3 border-t border-border space-y-1.5">
      <Label htmlFor={`end-series-${job.id}`} className="text-ds-11">
        End this recurring series. No new visits are booked or charged; visits already booked still go ahead; a paid visit nobody is booked on is refunded less the card fee. The poster and the Helprs booked on it are told. Say why:
      </Label>
      <Textarea
        id={`end-series-${job.id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="e.g. the poster asked support to stop it"
      />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive border-destructive/40 hover:bg-[hsl(var(--destructive)/0.10)]"
        onClick={endSeries}
        disabled={busy || reason.trim().length < END_SERIES_REASON_MIN}
      >
        <CalendarX className="w-3.5 h-3.5" /> {busy ? "Ending…" : "End series"}
      </Button>
    </div>
  );
}
