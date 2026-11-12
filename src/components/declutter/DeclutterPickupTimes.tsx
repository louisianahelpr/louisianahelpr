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
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { type PickupWindow } from "@/lib/declutter/api";
import { NativeSelect } from "@/components/ui/select";
import "@/lib/i18n/enListingParts";
import type { MsgKey } from "@/lib/i18n/en";
import { t } from "@/lib/i18n/language";
import { byDayThenStart, placeHoursLine, sameHoursEveryDay, shortDays, timeLabel } from "@/lib/declutter/pickupTimesText";

// The text helpers live in lib/declutter/pickupTimesText (the item page reads them without this editor).
export { placeHoursLine, sameHoursEveryDay, shortDays, timeLabel };

/** declutter_set_pickup_windows takes at most this many windows. */
const MAX_WINDOWS = 21;
const DEFAULT_RANGE = { starts: "09:00", ends: "12:00" };
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** A weekday in the member's language (F260q; WEEKDAYS keeps the English for other screens). */
const dayWord = (d: number) => t(`lp.day.${d}` as MsgKey);
const dayShort = (d: number) => t(`lp.dayShort.${d}` as MsgKey);

/** Half-hour steps from 6:00 AM to 10:00 PM, as "HH:MM". */
export const TIME_STEPS: string[] = Array.from({ length: 33 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/**
 * ONE weekday chip for every Sun-Sat picker in Declutter (audit 1030 DC-3: the porch days and the pickup-time
 * days were two pickers with chips of different sizes). The pickup times' Days row and the porch-days choice
 * (SellPorchDays.tsx) both use it.
 */
export function DayChip({ day, on, onToggle, disabled }: { day: number; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    // Named by content, not aria-label (WCAG 2.5.3, axe 4.14 label-content-name-mismatch, lead 11-04): the drawn
    // "Sat" is aria-hidden and the hidden "Saturday" is the name, as the job tracker's step tips do.
    <ToggleChip pressed={on} disabled={disabled} onClick={onToggle} data-day-chip="" className="min-w-[3.25rem] justify-center px-3">
      <span aria-hidden="true">{dayShort(day)}</span>
      <span className="sr-only">{dayWord(day)}</span>
    </ToggleChip>
  );
}

function TimeSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  // A saved time off the half-hour grid (an older window) is kept and shown, not silently moved.
  const steps = TIME_STEPS.includes(value) ? TIME_STEPS : [...TIME_STEPS, value].sort();
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}
        // 375 (B47/B50 measured 2026-10-31; guard pickupTimeSelectsFitAPhone): with px-3 a 97 px select cut "12:00 PM" to "12:00 P" and "9:00 AM" to "9:00 AN" (the
        // arrow takes the right side). Less side padding and a narrower row gap give the text the room; type unchanged.
        className="pl-2.5 pr-6 text-ds-14">
        {steps.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
      </NativeSelect>
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
        <TimeSelect id={`${idBase}-from`} label={t("lp.pt.from")} value={w.starts} onChange={(v) => onChange({ ...w, starts: v })} />
        <span className="text-ds-13 text-muted-foreground" aria-hidden>{t("lp.pt.to")}</span>
        <TimeSelect id={`${idBase}-to`} label={t("lp.pt.until")} value={w.ends} onChange={(v) => onChange({ ...w, ends: v })} />
        {onRemove ? (
          // The shared compact ghost icon (44 tap, 40 wash), not a hand-made button. The 16px X stays: a remove
          // mark beside two time fields, smaller than a toolbar icon (B47 10-31).
          <Button type="button" variant="ghost" size="iconCompact" onClick={onRemove} aria-label={removeLabel}
            className="rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-4">
            <X aria-hidden />
          </Button>
        ) : <span className="w-11" aria-hidden />}
      </div>
      {bad && <p className="text-ds-13 font-semibold text-destructive-ink" data-window-problem="">{t("lp.pt.endAfterStart")}</p>}
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
        <legend className="text-ds-13 font-semibold text-foreground">{t("lp.pt.days")}</legend>
        <div className="flex flex-wrap gap-2">
          {SHORT.map((label, d) => <DayChip key={label} day={d} on={days.includes(d)} onToggle={() => toggleDay(d)} />)}
        </div>
      </fieldset>

      {days.length === 0 ? (
        <p className="text-ds-13 text-muted-foreground" data-no-days="">{t("lp.pt.noDays")}</p>
      ) : (
        <>
          {/* The shared glossy control (segmentedControlInvariant), not a hand-painted pair. */}
          <SegmentedControl
            ariaLabel={t("lp.pt.hours")}
            options={[{ value: "same" as const, label: t("lp.pt.same") }, { value: "each" as const, label: t("lp.pt.each") }]}
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
                    <p className="text-ds-14 font-semibold text-foreground">{dayWord(d)}</p>
                    {mine.map(({ w, i }, k) => (
                      <RangeRow key={i} idBase={`pw-${d}-${k}`} w={w}
                        onChange={(r) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, starts: r.starts, ends: r.ends } : x)))}
                        onRemove={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                        removeLabel={t("lp.pt.remove", { day: dayWord(d), from: timeLabel(w.starts), to: timeLabel(w.ends) })} />
                    ))}
                    {windows.length < MAX_WINDOWS && (
                      <InlineTextButton className="inline-flex items-center gap-1 text-ds-13 font-semibold text-[hsl(var(--sage-ink))]" data-add-time-on={d}
                        onClick={() => setWindows((ws) => [...ws, { weekday: d, starts: "17:00", ends: "19:00" }].sort(byDayThenStart))}>
                        <Plus className="h-4 w-4" aria-hidden />{t("lp.pt.addOn", { day: dayWord(d) })}
                      </InlineTextButton>
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
  if (windows.length === 0) return t("lp.pt.needOne");
  if (windows.length > MAX_WINDOWS) return t("lp.pt.atMost", { n: MAX_WINDOWS });
  if (windows.some((w) => w.ends <= w.starts)) return t("lp.pt.endAfter");
  return null;
}

// Declutter settings' separate "Pickup times" card is gone (LEAD-PLACE-TIMES, owner 2026-10-31): each pickup place
// carries its own days and hours (SellPorchPlaces), set with PickupTimesEditor above.

