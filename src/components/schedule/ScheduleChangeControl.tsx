import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { hapticError } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";
import { fetchPendingScheduleChange, requestScheduleChange, respondScheduleChange } from "@/lib/scheduleChange";

const when = (date: string, time: string | null) =>
  `${formatJobDate(date)}${time ? ` at ${jobStartTimeLabel(time) ?? time.slice(0, 5)}` : ""}`;

/**
 * Change the date or time of a booked one-time job, by request (owner
 * decision Q407 (8)). Either party asks; the OTHER one accepts or declines;
 * nothing moves until it is accepted; a request unanswered by the original
 * start expires. The same control on both parties' cards: a person, not a role.
 */
export function ScheduleChangeControl({
  jobId,
  jobTitle,
  userId,
  dateNeeded,
  startTime,
}: {
  jobId: string;
  jobTitle: string | null;
  userId: string;
  dateNeeded: string;
  startTime: string | null;
}) {
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState(dateNeeded);
  const [time, setTime] = useState((startTime ?? "").slice(0, 5));
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const key = ["schedule-change", jobId];

  const { data: pending } = useQuery({
    queryKey: key,
    staleTime: 30_000,
    queryFn: () => fetchPendingScheduleChange(jobId),
  });

  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(userId) }),
    ]);
  };

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await settle();
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const askedOfMe = !!pending && pending.responder_id === userId;
  const askedByMe = !!pending && pending.requested_by === userId;

  return (
    <div className="px-4 py-2 border-t border-border/20 space-y-2" data-schedule-change onClick={(e) => e.stopPropagation()}>
      {askedOfMe && pending && (
        <div className="space-y-2">
          <p className="text-ds-12 text-foreground leading-snug">
            <CalendarClock className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden />
            They asked to move this to <span className="font-semibold">{when(pending.new_date, pending.new_start_time)}</span>.
            Nothing changes unless you accept.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const s = await respondScheduleChange(pending.id, true);
                  return s === "accepted" ? "Accepted. The job has the new date and time." : "That request has expired, so nothing changed.";
                })
              }
              className="btn-grad-primary min-h-[44px] px-4 rounded-ds-md text-ds-12 font-semibold disabled:opacity-40"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const s = await respondScheduleChange(pending.id, false);
                  return s === "declined" ? "Declined. The original date and time stay." : "That request has expired, so nothing changed.";
                })
              }
              className="min-h-[44px] px-4 rounded-ds-md text-ds-12 font-semibold border border-border disabled:opacity-40"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {askedByMe && pending && (
        <p className="text-ds-11 text-muted-foreground leading-snug">
          You asked to move this to {when(pending.new_date, pending.new_start_time)}. Waiting for an answer; it lapses at the
          current start time.
        </p>
      )}

      {!askedOfMe && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="min-h-[44px] px-1 text-ds-11 font-semibold underline underline-offset-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          {askedByMe ? "Ask for a different date or time" : "Ask for a new date or time"}
        </button>
      )}

      <BrandConfirmDialog
        open={asking}
        onOpenChange={(next) => {
          if (!busy) setAsking(next);
        }}
        title={`New date or time for "${jobTitle ?? "this job"}"`}
        description="The other person has to accept before anything changes. If they decline or don't answer before the current start, the job stays as it is and the usual cancellation rules apply. Pay doesn't change."
        primaryLabel={busy ? "Sending…" : "Send request"}
        primaryDisabled={busy || !date}
        onPrimary={(e) => {
          e.preventDefault();
          void act(async () => {
            await requestScheduleChange(jobId, date, time ? `${time}:00` : null);
            setAsking(false);
            return "Request sent. Nothing changes unless they accept.";
          });
        }}
        secondaryLabel="Cancel"
      >
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <label className="space-y-1 text-ds-12 text-foreground">
            <span className="block font-semibold">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[44px] rounded-ds-md border border-border px-3 bg-background"
            />
          </label>
          <label className="space-y-1 text-ds-12 text-foreground">
            <span className="block font-semibold">Start time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full min-h-[44px] rounded-ds-md border border-border px-3 bg-background"
            />
          </label>
        </div>
      </BrandConfirmDialog>
    </div>
  );
}
