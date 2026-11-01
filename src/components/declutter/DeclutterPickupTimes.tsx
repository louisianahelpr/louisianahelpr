/**
 * The seller's usual pickup times (spec row 52, B6), one editor for the sell
 * form, moving-out mode and seller delivery's times. They apply to all the
 * seller's listings (declutter_set_pickup_windows replaces the whole set).
 *
 * Owner 2026-10-28: "update the day and time picker" (a day dropdown and two
 * time fields per row was clunky). Now: tap the days as chips, then set ONE
 * range for every chosen day ("Same hours every day"), or a range per day with
 * more than one window a day. Times are picked from half-hour steps, shown as
 * "9:00 AM". The windows it hands back are the same {weekday, starts, ends}
 * rows the server already takes (at most 21; it refuses an end before a start).
 */
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { type PickupWindow } from "@/lib/declutter/api";
import { WEEKDAYS } from "./declutterUi";

/** declutter_set_pickup_windows takes at most this many windows. */
const MAX_WINDOWS = 21;
const DEFAULT_RANGE = { starts: "09:00", ends: "12:00" };
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Half-hour steps from 6:00 AM to 10:00 PM, as "HH:MM". */
export const TIME_STEPS: string[] = Array.from({ length: 33 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** "09:00" -> "9:00 AM", "17:30" -> "5:30 PM". */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** True when every chosen day has exactly one window and they all share one range. */
export function sameHoursEveryDay(windows: PickupWindow[]): boolean {
  if (windows.length === 0) return true;
  const days = new Set(windows.map((w) => w.weekday));
  return days.size === windows.length && windows.every((w) => w.starts === windows[0].starts && w.ends === windows[0].ends);
}

/**
 * ONE weekday chip for every Sun-Sat picker in Declutter (audit 1030 DC-3: the porch days and the pickup-time
 * days were two pickers with chips of different sizes). The pickup times' Days row and the porch-days choice
 * (SellPorchDays.tsx) both use it.
 */
export function DayChip({ day, on, onToggle, disabled }: { day: number; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} aria-label={WEEKDAYS[day]} disabled={disabled} onClick={onToggle} data-day-chip=""
      className={`flex h-11 min-w-[3.25rem] items-center justify-center rounded-full px-3 text-ds-13 font-semibold focus-visible:ring-2 focus-visible:ring-ring ${on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"}`}>
      {SHORT[day]}
    </button>
  );
}

/** "Sat, Sun": short weekday names, in week order. */
export function shortDays(days: readonly number[] | null | undefined): string {
  // A row missing its days (an older server, a mocked read) shows nothing rather than blanking the page (review 2026-10-31).
  if (!Array.isArray(days)) return "";
  return [...days].sort((a, b) => a - b).map((d) => SHORT[d]).filter(Boolean).join(", ");
}

const byDayThenStart = (a: PickupWindow, b: PickupWindow) => a.weekday - b.weekday || a.starts.localeCompare(b.starts);

function TimeSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  // A saved time off the half-hour grid (an older window) is kept and shown, not silently moved.
  const steps = TIME_STEPS.includes(value) ? TIME_STEPS : [...TIME_STEPS, value].sort();
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        // 375 (B47/B50 measured 2026-10-31; guard pickupTimeSelectsFitAPhone): with px-3 a 97 px select cut "12:00 PM" to "12:00 P" and "9:00 AM" to "9:00 AN" (the
        // arrow takes the right side). Less side padding and a narrower row gap give the text the room; type unchanged.
        className="h-11 w-full min-w-0 rounded-[12px] border border-border bg-card pl-2.5 pr-1 text-ds-14 text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {steps.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
      </select>
    </>
  );
}

function RangeRow({ idBase, w, onChange, onRemove, removeLabel }: {
  idBase: string; w: { starts: string; ends: string }; onChange: (r: { starts: string; ends: string }) => void;
  onRemove?: () => void; removeLabel?: string;
}) {
  const bad = w.ends <= w.starts;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5">
        <TimeSelect id={`${idBase}-from`} label="From" value={w.starts} onChange={(v) => onChange({ ...w, starts: v })} />
        <span className="text-ds-13 text-muted-foreground" aria-hidden>to</span>
        <TimeSelect id={`${idBase}-to`} label="Until" value={w.ends} onChange={(v) => onChange({ ...w, ends: v })} />
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label={removeLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : <span className="w-11" aria-hidden />}
      </div>
      {bad && <p className="text-ds-13 font-semibold text-destructive-ink" data-window-problem="">The end time must be after the start.</p>}
    </div>
  );
}

export function PickupTimesEditor({ windows, setWindows }: { windows: PickupWindow[]; setWindows: (f: (ws: PickupWindow[]) => PickupWindow[]) => void }) {
  const [perDay, setPerDay] = useState(() => !sameHoursEveryDay(windows));
  const days = [...new Set(windows.map((w) => w.weekday))].sort((a, b) => a - b);
  const shared = windows[0] ?? { weekday: 0, ...DEFAULT_RANGE };

  const toggleDay = (d: number) =>
    setWindows((ws) => {
      if (ws.some((w) => w.weekday === d)) return ws.filter((w) => w.weekday !== d);
      if (ws.length >= MAX_WINDOWS) return ws;
      const range = ws[0] ? { starts: ws[0].starts, ends: ws[0].ends } : DEFAULT_RANGE;
      return [...ws, { weekday: d, ...range }].sort(byDayThenStart);
    });
  const setShared = (r: { starts: string; ends: string }) => setWindows((ws) => ws.map((w) => ({ ...w, starts: r.starts, ends: r.ends })));
  const chooseSameHours = () => {
    setPerDay(false);
    // One window per chosen day, all with the first window's hours.
    setWindows((ws) => {
      const first = ws[0] ?? { weekday: 0, ...DEFAULT_RANGE };
      return [...new Set(ws.map((w) => w.weekday))].sort((a, b) => a - b).map((d) => ({ weekday: d, starts: first.starts, ends: first.ends }));
    });
  };

  return (
    <div className="space-y-4" data-pickup-times="">
      <fieldset className="space-y-2">
        <legend className="text-ds-13 font-semibold text-foreground">Days</legend>
        <div className="flex flex-wrap gap-2">
          {SHORT.map((label, d) => <DayChip key={label} day={d} on={days.includes(d)} onToggle={() => toggleDay(d)} />)}
        </div>
      </fieldset>

      {days.length === 0 ? (
        <p className="text-ds-13 text-muted-foreground" data-no-days="">Pick at least one day buyers can come.</p>
      ) : (
        <>
          {/* The shared glossy control (segmentedControlInvariant), not a hand-painted pair. */}
          <SegmentedControl
            ariaLabel="Hours"
            options={[{ value: "same" as const, label: "Same hours every day" }, { value: "each" as const, label: "Different each day" }]}
            value={perDay ? "each" : "same"}
            onChange={(v) => (v === "each" ? setPerDay(true) : chooseSameHours())}
          />

          {!perDay ? (
            <div className="space-y-1" data-same-hours="">
              <p className="text-ds-13 text-muted-foreground">{shortDays(days)}</p>
              <RangeRow idBase="pw-all" w={shared} onChange={setShared} />
            </div>
          ) : (
            <ul className="space-y-3" data-per-day="">
              {days.map((d) => {
                const mine = windows.map((w, i) => ({ w, i })).filter((x) => x.w.weekday === d);
                return (
                  <li key={d} className="space-y-2 rounded-[14px] border border-border bg-card p-3">
                    <p className="text-ds-14 font-semibold text-foreground">{WEEKDAYS[d]}</p>
                    {mine.map(({ w, i }, k) => (
                      <RangeRow key={i} idBase={`pw-${d}-${k}`} w={w}
                        onChange={(r) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, starts: r.starts, ends: r.ends } : x)))}
                        onRemove={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                        removeLabel={`Remove ${WEEKDAYS[d]} ${timeLabel(w.starts)} to ${timeLabel(w.ends)}`} />
                    ))}
                    {windows.length < MAX_WINDOWS && (
                      <button type="button" className="inline-flex min-h-11 items-center gap-1 text-ds-13 font-semibold text-[hsl(var(--sage-ink))] focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setWindows((ws) => [...ws, { weekday: d, starts: "17:00", ends: "19:00" }].sort(byDayThenStart))}>
                        <Plus className="h-4 w-4" aria-hidden />Add another time on {WEEKDAYS[d]}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** What is wrong with the windows, in plain words, or null (mirrors declutter_set_pickup_windows). */
export function pickupWindowsProblem(windows: PickupWindow[]): string | null {
  if (windows.length === 0) return "Pick at least one day and time buyers can come.";
  if (windows.length > MAX_WINDOWS) return `Choose at most ${MAX_WINDOWS} pickup times.`;
  if (windows.some((w) => w.ends <= w.starts)) return "Each pickup time must end after it starts.";
  return null;
}

// Declutter settings' separate "Pickup times" card is gone (LEAD-PLACE-TIMES, owner 2026-10-31): each pickup place
// carries its own days and hours (SellPorchPlaces), set with PickupTimesEditor above.

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat 9:00 AM–12:00 PM", or "3 pickup times" when the days differ. */
export function windowsSummary(windows: PickupWindow[]): string {
  if (windows.length === 0) return "";
  if (!sameHoursEveryDay(windows)) return `${windows.length} pickup times`;
  const days = [...windows].sort((a, b) => a.weekday - b.weekday).map((w) => SHORT_DAY[w.weekday]).join(", ");
  return `${days} ${timeLabel(windows[0].starts)}–${timeLabel(windows[0].ends)}`;
}

/**
 * One place's days and hours in words (LEAD-POST-PLACES): "Every day 7:00 AM–9:00 PM", "Mon, Wed 9:00 AM–12:00 PM",
 * or per day when they differ: "Sat 9:00 AM–12:00 PM; Sun 1:00 PM–3:00 PM". No hours (an older server): the days.
 */
export function placeHoursLine(windows: PickupWindow[] | null | undefined, weekdays: number[] | null | undefined): string {
  const ws = (windows ?? []).filter((w) => w && typeof w.starts === "string" && typeof w.ends === "string");
  if (ws.length === 0) return shortDays(weekdays);
  const range = (w: PickupWindow) => `${timeLabel(w.starts)}–${timeLabel(w.ends)}`;
  if (sameHoursEveryDay(ws)) {
    const days = [...new Set(ws.map((w) => w.weekday))];
    return `${days.length === 7 ? "Every day" : shortDays(days)} ${range(ws[0])}`;
  }
  const byDay = new Map<number, PickupWindow[]>();
  for (const w of [...ws].sort(byDayThenStart)) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
  return [...byDay.entries()].map(([d, list]) => `${SHORT_DAY[d]} ${list.map(range).join(", ")}`).join("; ");
}
