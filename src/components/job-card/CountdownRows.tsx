import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { jobStartDateTime } from "@/lib/dateUtils";

/**
 * TWO CLOCKS, ONE FORMAT, SOONEST FIRST (owner, 2026-10-07, on job 4d7f3085
 * at 375, Q1399): an offer card carried "Job starts in: 2d 16h 5m" as a grey
 * pill and "18h 9m remaining / No answer counts..." as a cream box, on the
 * Helpr's card, and on the poster's collapsed card the start pill sat above
 * the footer while "18h 9m left for them to confirm" (now "to accept") sat in it. Every clock on
 * those cards is now a row here, `<time> <what it is counting to>`, in the
 * same type and ink, ordered by the instant it ends.
 *
 * `bare` is for the collapsed card's status strip (it supplies surface and
 * ink); `box` is the expanded offer card's panel, with one `note` under the
 * rows for the consequence that belongs to them as a set.
 *
 * Guard: src/test/offerCountdownRows.test.tsx.
 */
export interface CountdownClock {
  /** Stable key and test hook (`data-countdown-row`). */
  id: string;
  /** The instant the clock runs to. A null clock is dropped. */
  at: Date | string | null;
  /** Read after the time: "left to answer", "until the job starts". */
  text: string;
  /** Shown in place of the row once the instant has passed. */
  expiredText: string;
}

/** The instant a job starts: its start time in the job's zone, or the END of
 *  its day when it has none ("sometime that day" has not run out until the
 *  day has). The same target JobCountdown counts to. */
export function jobStartTarget(dateNeeded: string | null | undefined, startTime?: string | null): Date | null {
  if (!dateNeeded) return null;
  if (startTime) return jobStartDateTime(dateNeeded, startTime);
  const midnight = jobStartDateTime(dateNeeded, null);
  return midnight ? new Date(midnight.getTime() + 86_400_000 - 1_000) : null;
}

/** "2d 16h 5m" / "18h 9m" / "7m": the one duration format every card clock uses. */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const toMs = (at: Date | string) => (at instanceof Date ? at.getTime() : new Date(at).getTime());

/** The clocks that have an instant, soonest first (ties keep their order). */
export function orderClocks(clocks: readonly CountdownClock[]): (CountdownClock & { at: Date | string })[] {
  return clocks
    .filter((c): c is CountdownClock & { at: Date | string } => c.at != null && Number.isFinite(toMs(c.at)))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => toMs(a.c.at) - toMs(b.c.at) || a.i - b.i)
    .map(({ c }) => c);
}

export function CountdownRows({
  clocks,
  variant,
  note,
}: {
  clocks: readonly CountdownClock[];
  variant: "bare" | "box";
  note?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const rows = orderClocks(clocks);
  if (rows.length === 0) return null;

  const list = rows.map((c) => {
    const left = toMs(c.at) - now;
    return (
      <span key={c.id} data-countdown-row={c.id} className="flex items-center gap-1.5 text-ds-11 font-semibold">
        <Timer className={variant === "box" ? "w-3.5 h-3.5 shrink-0" : "w-3 h-3 shrink-0"} aria-hidden />
        {left <= 0 ? (
          <span>{c.expiredText}</span>
        ) : (
          <span>
            <span className="tabular-nums">{formatCountdown(left)}</span> {c.text}
          </span>
        )}
      </span>
    );
  });

  if (variant === "bare") {
    return (
      <span className="flex flex-col gap-0.5" data-countdown-rows="bare">
        {list}
      </span>
    );
  }
  return (
    <div
      className="p-2 rounded-ds-sm border flex flex-col gap-1"
      data-countdown-rows="box"
      style={{
        background: "hsl(var(--amber-tint) / 0.12)",
        borderColor: "hsl(var(--amber-tint) / 0.30)",
        color: "hsl(var(--amber-ink))",
      }}
    >
      {list}
      {note && (
        <p className="text-ds-10 leading-snug" data-countdown-note="">
          {note}
        </p>
      )}
    </div>
  );
}
