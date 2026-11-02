import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { userFacingError } from "@/lib/userFacingError";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { TimePickerWheel } from "@/components/TimePickerWheel";
import { Textarea } from "@/components/ui/textarea";
import { formatJobDate } from "@/lib/dateUtils";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { hapticError } from "@/lib/haptics";
import { continueDayLabel, proposeContinueDay } from "@/lib/continueDay";

/** Today's chip, when today is offered: it is "another day" only in the sense of later today (Q2606). */
const LATER_TODAY = "Later today";

/** The next 30 days from today (the server's own limit, propose_job_continue_day). */
const DAYS = 30;
/** Today is offered only before 10 PM: a start at least an hour out (propose_job_continue_day) must still fit in it. */
const LAST_START_HOUR_TODAY = 22;

/**
 * "Not finished? Set a day" (both sides, one name since Q2593): the rest of a job under way moves to a new
 * day and time (owner 2026-11-01, Yusef's job). The Helpr's pick goes to the poster to confirm; the poster's is set at
 * once. The job stays in progress and the payment stays held; a Helpr's earlier "done" is cleared when the day is set.
 * Built on ChangeJobSheet's day strip and time wheel.
 */
export function ContinueDaySheet({
  open,
  onOpenChange,
  jobId,
  side,
  otherFirst,
  onSaved,
  helprMarkedDone = false,
  today = new Date(),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  side: "poster" | "helpr";
  otherFirst: string | null;
  onSaved: () => void;
  /** The Helpr already marked it done: the day is to come back, so today is not offered (A3-119). */
  helprMarkedDone?: boolean;
  /** For tests: the first day of the strip. */
  today?: Date;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // A3-119 (Auditor 11, 11-01): today only while a start an hour out still fits in it (the server's own 1-hour rule),
  // and never once the Helpr marked it done (they come back another day: tomorrow onward).
  const offerToday = !helprMarkedDone && today.getHours() < LAST_START_HOUR_TODAY;
  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => format(addDays(today, i), "yyyy-MM-dd")).slice(offerToday ? 0 : 1),
    [today, offerToday],
  );
  const todayKey = format(today, "yyyy-MM-dd");
  const other = (otherFirst ?? "").trim();
  const poster = side === "poster";

  const save = async () => {
    setBusy(true);
    try {
      const out = await proposeContinueDay(jobId, date, time, note);
      const when = continueDayLabel(date, time);
      toast(out.status === "set" ? `Set: continuing ${when}.` : `Sent. ${other || "They"} will confirm ${when}.`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "Couldn't save that. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent
        side="bottom"
        data-continue-day-sheet={side}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        <SheetHero title="Set a day to finish" />
        <p className="text-ds-13 text-muted-foreground">
          {poster
            ? `${other || "Your Helpr"} comes back to finish. The payment stays held until the work is done.`
            : `${other || "The person who posted it"} confirms the day. The payment stays held until you finish.`}
        </p>
        <div className="mt-4 space-y-3">
          <p className="text-ds-14 font-semibold">Day</p>
          <div role="radiogroup" aria-label="Day to finish" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
            {days.map((d) => (
              <ChoicePill key={d} selected={date === d} className="shrink-0" onClick={() => setDate(d)}>
                {/* Q2606 (Jobs audit 1102b row 20): today, first in a list of "another day", reads "Later today". */}
                {d === todayKey ? LATER_TODAY : formatJobDate(d)}
              </ChoicePill>
            ))}
          </div>
          <TimePickerWheel value={time} onChange={setTime} ariaLabel="Start time" />
          {/* A3-119: what setting a day does to a "done" already sent (the server clears it; the payment stays held). */}
          {helprMarkedDone && (
            <p data-continue-day-effect="" className="text-ds-13 text-muted-foreground">
              {poster
                ? `${other || "Your Helpr"}'s "done" is cleared and the payment waits until the work is finished.`
                : `Your "done" is cleared and your payment waits until the work is finished.`}
            </p>
          )}
          <label className="block space-y-1">
            <span className="text-ds-14 font-semibold">Note (optional)</span>
            <Textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)}
              placeholder={poster ? "What's left to do" : "What's left, and why"} />
          </label>
          <SheetFooter>
            <SheetPrimaryAction disabled={busy || !date || !time} onClick={() => void save()}>
              {busy ? "Saving…" : poster ? "Set the day" : `Send to ${other || "them"}`}
            </SheetPrimaryAction>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
