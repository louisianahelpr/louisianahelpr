import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Sheet, SheetContent, SheetDestructiveAction, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { TimePickerWheel } from "@/components/TimePickerWheel";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { chipStyles } from "@/components/dashboard/JobFilters";
import { useScheduleChangeAct } from "./ScheduleChangeControl";
import { requestScheduleChange } from "@/lib/scheduleChange";

/** The next 60 days, from tomorrow (JOBS-19: 14 could not move a job further out; request_job_schedule_change sets only a one-hour floor). No Helpr availability shown (board 66). */
const DAYS = 60;

/**
 * Board 66 (poster: reschedule or cancel a hired job), one sheet over what
 * already exists:
 *   - "Pick a new time" sends a request through request_job_schedule_change
 *     (the Helpr accepts or declines; nothing moves until then; pay does not
 *     change; the money lock is passed only by that RPC),
 *   - "Cancel the job" hands over to the existing CancellationDialog, which
 *     shows the fee from the shared ladder before anything is confirmed.
 * Names, never pronouns. Nothing is charged by asking for a new time.
 */
export function ChangeJobSheet({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  helperName,
  userId,
  dateNeeded,
  startTime,
  onCancelJob,
  today = new Date(),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string | null;
  helperName: string;
  userId: string;
  dateNeeded: string;
  startTime: string | null;
  /** Opens the existing cancellation dialog (fee from the shared ladder). */
  onCancelJob: () => void;
  /** For tests: the day the strip starts after. */
  today?: Date;
}) {
  const [choice, setChoice] = useState<"time" | "cancel">("time");
  const [date, setDate] = useState("");
  const [time, setTime] = useState((startTime ?? "").slice(0, 5));
  const { busy, act } = useScheduleChangeAct(jobId, userId);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => format(addDays(today, i + 1), "yyyy-MM-dd")), [today]);
  const first = helperName.split(" ")[0] || helperName;
  const now = [formatJobDate(dateNeeded), jobStartTimeLabel(startTime)].filter(Boolean).join(" · ");
  const unchanged = date === dateNeeded && time === (startTime ?? "").slice(0, 5);
  const { chipBase, chipActive, chipIdle } = chipStyles;
  // The shared chip is 40 px (board 24); this strip is thumbed sideways on a phone, so its chips meet the 44 px floor.
  const dayChip = chipBase.replace("min-h-10", "min-h-11");
  const card = (on: boolean) =>
    `flex w-full items-start gap-3 rounded-[20px] bg-card px-4 py-3.5 text-left ${on ? "border-2 border-primary" : "border border-border"}`;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        <SheetHero title="Change this job" />
        <p className="text-ds-13 text-muted-foreground">{[jobTitle, helperName, now].filter(Boolean).join(" · ")}</p>
        <div role="radiogroup" aria-label="What to change" className="mt-3 space-y-2">
          <button type="button" role="radio" aria-checked={choice === "time"} className={card(choice === "time")} onClick={() => setChoice("time")}>
            <span aria-hidden className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${choice === "time" ? "border-primary bg-primary" : "border-border"}`} />
            <span className="min-w-0">
              <span className="block text-ds-15 font-semibold">Pick a new time</span>
              <span className="block text-ds-13 text-muted-foreground">{first} gets the new time and says yes or no. Nothing is charged, and the pay stays the same.</span>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "cancel"} className={card(choice === "cancel")} onClick={() => setChoice("cancel")}>
            <span aria-hidden className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${choice === "cancel" ? "border-primary bg-primary" : "border-border"}`} />
            <span className="min-w-0">
              <span className="block text-ds-15 font-semibold">Cancel the job</span>
              <span className="block text-ds-13 text-muted-foreground">Anything that goes to your Helpr for their time is shown before you confirm.</span>
            </span>
          </button>
        </div>

        {choice === "time" ? (
          <div className="mt-4 space-y-3">
            <p className="text-ds-14 font-semibold">New time</p>
            <div role="group" aria-label="New day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
              {days.map((d) => (
                <button key={d} type="button" aria-pressed={date === d} className={`${dayChip} shrink-0 ${date === d ? chipActive : chipIdle}`} onClick={() => setDate(d)}>
                  {formatJobDate(d)}
                </button>
              ))}
            </div>
            <TimePickerWheel value={time} onChange={setTime} ariaLabel="New start time" />
            <SheetFooter>
            <SheetPrimaryAction
              disabled={busy || !date || unchanged}
              onClick={() =>
                void act(async () => {
                  await requestScheduleChange(jobId, date, time ? `${time}:00` : null);
                  onOpenChange(false);
                  return `Sent. Nothing changes unless ${first} says yes.`;
                })
              }
            >
              {busy ? "Sending…" : `Send new time to ${first}`}
            </SheetPrimaryAction>
            </SheetFooter>
          </div>
        ) : (
          <SheetFooter>
            <SheetDestructiveAction
              onClick={() => {
                onOpenChange(false);
                onCancelJob();
              }}
            >
              Review cancellation
            </SheetDestructiveAction>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
