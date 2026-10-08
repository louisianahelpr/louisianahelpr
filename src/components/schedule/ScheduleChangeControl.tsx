import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { hapticError } from "@/lib/haptics";
import { userFacingError } from "@/lib/userFacingError";
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
/** The job's open date-change request, shared by every reader of it (one cache key). */
export function usePendingScheduleChange(jobId: string, enabled = true) {
  return useQuery({
    queryKey: ["schedule-change", jobId],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchPendingScheduleChange(jobId),
  });
}

/** Re-read the request and both activity lists after a change to it. */
function useSettleScheduleChange(jobId: string, userId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["schedule-change", jobId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(userId) }),
    ]);
  };
}

function useScheduleChangeAct(jobId: string, userId: string) {
  const [busy, setBusy] = useState(false);
  const settle = useSettleScheduleChange(jobId, userId);
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await settle();
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "Couldn't update the date change. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/**
 * The "new date or time" form, on its own so a card can open it from a button
 * in its action row (owner, 2026-10-07, Q1399: on the poster's card the ask
 * is a button left of Message) as well as from the link below.
 */
export function ScheduleChangeAskDialog({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  userId,
  dateNeeded,
  startTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string | null;
  userId: string;
  dateNeeded: string;
  startTime: string | null;
}) {
  const [date, setDate] = useState(dateNeeded);
  const [time, setTime] = useState((startTime ?? "").slice(0, 5));
  const { busy, act } = useScheduleChangeAct(jobId, userId);
  // The form opens on the job's own date and time; sending that unchanged is
  // refused by the RPC (schedule_change_same), so the button waits for a
  // change instead of offering a press that can only fail (press run
  // 36297439015, Q772).
  const unchanged = date === dateNeeded && time === (startTime ?? "").slice(0, 5);
  return (
      <BrandConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) onOpenChange(next);
        }}
        title={`New date or time for "${jobTitle ?? "this job"}"`}
        description="The other person has to accept before anything changes. If they decline or don't answer before the current start, the job stays as it is and the usual cancellation rules apply. Pay doesn't change."
        primaryLabel={busy ? "Sending…" : "Send request"}
        primaryDisabled={busy || !date || unchanged}
        onPrimary={(e) => {
          e.preventDefault();
          void act(async () => {
            await requestScheduleChange(jobId, date, time ? `${time}:00` : null);
            onOpenChange(false);
            return "Request sent. Nothing changes unless they accept.";
          });
        }}
        secondaryLabel="Cancel"
      >
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
          <label className="min-w-0 space-y-1 text-ds-12 text-foreground">
            <span className="block font-semibold">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              // min-w-0 + no native appearance: iOS gives date/time fields an
              // intrinsic width wider than half a phone dialog, so the pair
              // overlapped and ran off the edge (owner, iPhone, 2026-10-08).
              className="block w-full min-w-0 appearance-none min-h-[44px] rounded-ds-md border border-border px-3 bg-background text-left"
            />
          </label>
          <label className="min-w-0 space-y-1 text-ds-12 text-foreground">
            <span className="block font-semibold">Start time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              // min-w-0 + no native appearance: iOS gives date/time fields an
              // intrinsic width wider than half a phone dialog, so the pair
              // overlapped and ran off the edge (owner, iPhone, 2026-10-08).
              className="block w-full min-w-0 appearance-none min-h-[44px] rounded-ds-md border border-border px-3 bg-background text-left"
            />
          </label>
        </div>
      </BrandConfirmDialog>
  );
}

export function ScheduleChangeControl({
  jobId,
  jobTitle,
  userId,
  dateNeeded,
  startTime,
  hideAsk = false,
}: {
  jobId: string;
  jobTitle: string | null;
  userId: string;
  dateNeeded: string;
  startTime: string | null;
  /** The card draws the ask as a button in its own action row (the poster's
   *  ScheduledStep), so this block shows only the request's state. */
  hideAsk?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const { busy, act } = useScheduleChangeAct(jobId, userId);
  const { data: pending } = usePendingScheduleChange(jobId);

  const askedOfMe = !!pending && pending.responder_id === userId;
  const askedByMe = !!pending && pending.requested_by === userId;
  if (hideAsk && !pending) return null;

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
                  if (s === "accepted") return "Accepted. The job has the new date and time.";
                  if (s === "clash") return "The Helpr is already booked at that time, so this change couldn't be accepted. The original date and time stay.";
                  return "That request has expired, so nothing changed.";
                })
              }
              // SECONDARY, never the gradient primary (owner, 2026-10-05): this block
              // sits on cards whose ONE primary is the job's own next move (Accept
              // Job on an offer), and a second gradient button beside it read as
              // a disabled primary. Guard: src/test/offerCardHierarchy.test.tsx.
              className="min-h-[44px] px-4 rounded-ds-md text-ds-12 font-semibold border disabled:opacity-40"
              style={{ color: "hsl(var(--primary))", borderColor: "hsl(var(--primary) / 0.35)" }}
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

      {!askedOfMe && !hideAsk && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="min-h-[44px] px-1 text-ds-11 font-semibold underline underline-offset-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          {askedByMe ? "Ask for a different date or time" : "Ask for a new date or time"}
        </button>
      )}

      {!hideAsk && (
        <ScheduleChangeAskDialog
          open={asking}
          onOpenChange={setAsking}
          jobId={jobId}
          jobTitle={jobTitle}
          userId={userId}
          dateNeeded={dateNeeded}
          startTime={startTime}
        />
      )}
    </div>
  );
}
