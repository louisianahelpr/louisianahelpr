import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { queryKeys } from "@/lib/queryKeys";
import { hapticError } from "@/lib/haptics";

/**
 * "End series" — the way out of a recurring series for BOTH parties: the
 * poster and the standing Helpr (end_recurring_series checks the caller is one
 * of the two). It works at every status of the parent, including after visit
 * one is completed, which is when poster_cancel_job no longer applies.
 *
 * Ending stops new visits: charge-recurring-visits funds no new visit of a
 * series with `series_ended_on` set, and the DB refuses one. Visits already created are funded and booked; each keeps
 * its own cancel path on its own card.
 */
export function EndSeriesControl({
  jobId,
  jobTitle,
  userId,
}: {
  jobId: string;
  jobTitle: string | null;
  userId: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const queryClient = useQueryClient();

  const endSeries = async () => {
    setEnding(true);
    try {
      const { data, error } = await supabase.rpc("end_recurring_series", { p_job_id: jobId });
      if (error) {
        // PGRST202 = the migration is merged but db-deploy has not finished,
        // so the RPC does not exist for a few minutes. There is no client-side
        // fallback: series_ended_on is never client-writable.
        if (String(error.code ?? "") === "PGRST202") {
          throw new Error(
            "Ending a series is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.",
          );
        }
        throw new Error(
          rpcErrorMessage("end_recurring_series", error) ?? error.message ?? "Couldn't end the series — please try again",
        );
      }
      const result = (data ?? {}) as { booked_visits_remaining?: number | null };
      const booked = result.booked_visits_remaining ?? 0;
      // "No new visits", not "nothing after <end date>": an ended series gets
      // no new visit at all, a gap before the end date included.
      toast.success(
        "Series ended. No new visits will be booked or charged.",
        booked > 0
          ? {
              description: `${booked} visit${booked === 1 ? " is" : "s are"} already booked and still on the calendar — cancel ${booked === 1 ? "it" : "any of them"} from ${booked === 1 ? "its" : "their"} own card.`,
            }
          : undefined,
      );
      setOpen(false);
      if (userId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(userId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(userId) }),
        ]);
      }
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't end the series — please try again");
    } finally {
      setEnding(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-end-series
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 min-h-[44px] -my-3 px-1 text-ds-11 font-semibold underline underline-offset-2"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        End series
      </button>
      <BrandConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!ending) setOpen(next);
        }}
        title={`End "${jobTitle ?? "this series"}"?`}
        description="No new visits will be booked or charged. Visits already booked stay on the calendar, and each can still be cancelled from its own card. This can't be undone."
        primaryLabel={ending ? "Ending…" : "End series"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={ending}
        onPrimary={(e) => {
          e.preventDefault();
          void endSeries();
        }}
        secondaryLabel="Cancel"
      />
    </>
  );
}
