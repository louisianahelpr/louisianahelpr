import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const ITEM_H = 40;
/** Rows visible above/below the centred selection band. */
const PAD_ROWS = 2;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface WheelColumnProps {
  /** Rendered labels, index-aligned with `values`. */
  labels: string[];
  values: number[];
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * One scroll column of the wheel. Selection follows the scroll position:
 * whichever row settles inside the centre band becomes the value, which is
 * what makes it read as an iOS picker rather than a list of buttons.
 *
 * The settle is detected with a timer rather than `scrollend` — Safari only
 * shipped that event in 17.4, and iOS momentum scrolling fires `scroll`
 * continuously until it stops, so a trailing debounce is both the portable
 * and the accurate signal.
 */
function WheelColumn({ labels, values, value, onChange, ariaLabel, className }: WheelColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number>();
  // Guards the scroll handler while WE are the ones moving the column
  // (mount, or a value change from another column clamping the day) —
  // otherwise the programmatic scroll echoes back as a user selection.
  const programmatic = useRef(false);

  const index = Math.max(0, values.indexOf(value));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Position from the ROW'S OWN offsetTop, never from index * ITEM_H.
    // The arithmetic version silently drifts the moment a row's real height
    // differs from the constant by even a pixel (inherited button padding
    // once made rows 44px, which opened the month and day columns two rows
    // off their own value while the year column happened to look fine
    // because its value sat at scrollTop 0).
    const row = el.querySelectorAll<HTMLElement>("[role=option]")[index];
    if (!row) return;
    const target = row.offsetTop - (el.clientHeight - row.offsetHeight) / 2;
    if (Math.abs(el.scrollTop - target) < 1) return;
    programmatic.current = true;
    // The popover mounts with an animation, so on the first pass the column
    // can still be zero-height — assigning scrollTop then silently clamps to
    // 0 and the wheel opens on the wrong row. Re-assert after a frame and
    // again once the animation has settled.
    const put = () => { el.scrollTop = target; };
    put();
    const raf = requestAnimationFrame(put);
    const late = window.setTimeout(() => { put(); programmatic.current = false; }, 120);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(late); };
  }, [index]);

  const handleScroll = () => {
    if (programmatic.current) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      // Whichever row's centre is nearest the column's centre wins — again
      // measured, not derived from a row-height constant.
      const mid = el.scrollTop + el.clientHeight / 2;
      const rows = el.querySelectorAll<HTMLElement>("[role=option]");
      let best = 0;
      let bestDist = Infinity;
      rows.forEach((row, i) => {
        const dist = Math.abs(row.offsetTop + row.offsetHeight / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      if (values[best] !== value) onChange(values[best]);
    }, 90);
  };

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
      className={cn(
        "relative h-[200px] overflow-y-auto snap-y snap-mandatory scrollbar-none",
        "focus-visible:outline-none",
        className,
      )}
      style={{ scrollbarWidth: "none" }}
    >
      <div style={{ height: PAD_ROWS * ITEM_H }} aria-hidden />
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "flex w-full snap-center items-center justify-center text-ds-15 transition-[color,opacity,font-weight] duration-150",
            v === value
              ? "font-semibold text-foreground"
              : "text-muted-foreground opacity-55",
          )}
          // Explicit box metrics: a stray 4px of inherited button padding
          // made each row 44px while the scroll maths assumed 40, so every
          // column landed a row or two off its own value.
          style={{ height: ITEM_H, minHeight: ITEM_H, padding: 0, boxSizing: "border-box", lineHeight: 1 }}
        >
          {labels[i]}
        </button>
      ))}
      <div style={{ height: PAD_ROWS * ITEM_H }} aria-hidden />
    </div>
  );
}

interface DateWheelPickerProps {
  /** `YYYY-MM-DD`, or "" when nothing is chosen yet. */
  value: string;
  onChange: (value: string) => void;
  minDate: Date;
  maxDate: Date;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Month / day / year scroll wheels — the iOS date-of-birth control.
 *
 * A calendar grid is the wrong shape for a birthday: it opens on one month
 * and reaching 1987 means paging (or hunting two dropdowns), where a wheel
 * puts the year one flick away.
 */
export function DateWheelPicker({ value, onChange, minDate, maxDate }: DateWheelPickerProps) {
  // With no value yet, start the wheels at the latest allowed date — for a
  // DOB that is the youngest eligible birthday, so a typical signup scrolls
  // a short distance rather than from year zero.
  const base = value ? new Date(`${value}T00:00:00`) : maxDate;
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();

  const minY = minDate.getFullYear();
  const maxY = maxDate.getFullYear();
  const years = Array.from({ length: maxY - minY + 1 }, (_, i) => maxY - i);

  // Only months/days that stay inside [minDate, maxDate] are offered, so a
  // wheel can never land on a date the validator would reject.
  const monthLo = year === minY ? minDate.getMonth() : 0;
  const monthHi = year === maxY ? maxDate.getMonth() : 11;
  const months = Array.from({ length: monthHi - monthLo + 1 }, (_, i) => monthLo + i);

  const dayLo = year === minY && month === minDate.getMonth() ? minDate.getDate() : 1;
  const dayHi =
    year === maxY && month === maxDate.getMonth() ? maxDate.getDate() : daysInMonth(year, month);
  const days = Array.from({ length: dayHi - dayLo + 1 }, (_, i) => dayLo + i);

  const emit = (y: number, m: number, d: number) => {
    // Re-clamp on every change: scrolling Jan 31 → February, or 2008 → a
    // boundary year, can strand the day outside the new month's range.
    const mm = clamp(m, y === minY ? minDate.getMonth() : 0, y === maxY ? maxDate.getMonth() : 11);
    const lo = y === minY && mm === minDate.getMonth() ? minDate.getDate() : 1;
    const hi = y === maxY && mm === maxDate.getMonth() ? maxDate.getDate() : daysInMonth(y, mm);
    onChange(iso(y, mm, clamp(d, lo, hi)));
  };

  return (
    <div className="relative px-3 py-1" style={{ width: 264 }}>
      {/* Centre band — the "selected" indicator the rows scroll through. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-3 rounded-ds-md"
        style={{
          top: `calc(50% - ${ITEM_H / 2}px)`,
          height: ITEM_H,
          background: "hsl(var(--olivewood) / 0.10)",
        }}
      />
      <div className="relative grid grid-cols-[1.4fr_0.8fr_1fr]">
        <WheelColumn
          ariaLabel="Month"
          labels={months.map((m) => MONTHS[m])}
          values={months}
          value={clamp(month, monthLo, monthHi)}
          onChange={(m) => emit(year, m, day)}
        />
        <WheelColumn
          ariaLabel="Day"
          labels={days.map(String)}
          values={days}
          value={clamp(day, dayLo, dayHi)}
          onChange={(d) => emit(year, month, d)}
        />
        <WheelColumn
          ariaLabel="Year"
          labels={years.map(String)}
          values={years}
          value={clamp(year, minY, maxY)}
          onChange={(y) => emit(y, month, day)}
        />
      </div>
    </div>
  );
}

export default DateWheelPicker;
