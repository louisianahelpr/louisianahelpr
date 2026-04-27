import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TimePickerWheelProps {
  /** "HH:mm" 24h format or "" for unset (matches existing form state). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i));
const MINUTE_OPTIONS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
const ITEM_HEIGHT = 44; // 44pt — Apple HIG minimum hit target

function parse24(time: string) {
  if (!time) return null;
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr || 0);
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  // Snap minute to nearest 5
  const snapped = MINUTE_OPTIONS.reduce((prev, curr) =>
    Math.abs(Number(curr) - m) < Math.abs(Number(prev) - m) ? curr : prev,
  );
  return { hour12, minute: snapped, period };
}

function to24(hour12: number, minute: string, period: "AM" | "PM") {
  let h = hour12;
  if (period === "AM" && h === 12) h = 0;
  if (period === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

interface WheelProps {
  options: (string | number)[];
  value: string | number | null;
  onChange: (v: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * Snap-scrolling vertical wheel column. The middle slot (highlighted) is
 * the selected value — scroll snap + scrollend fire onChange. Falls back
 * to scroll-debounce for browsers without scrollend (older iOS WebKit).
 */
function Wheel({ options, value, onChange, ariaLabel, disabled }: WheelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitted = useRef<string | null>(null);

  // Sync external value → scroll position
  useEffect(() => {
    const el = ref.current;
    if (!el || value == null) return;
    const idx = options.findIndex((o) => String(o) === String(value));
    if (idx < 0) return;
    el.scrollTo({ top: idx * ITEM_HEIGHT, behavior: "auto" });
    lastEmitted.current = String(value);
  }, [value, options]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(options.length - 1, idx));
      const v = String(options[clamped]);
      if (v !== lastEmitted.current) {
        lastEmitted.current = v;
        onChange(v);
      }
    }, 120);
  };

  return (
    <div
      className={cn(
        "relative flex-1 overflow-hidden rounded-2xl border border-input bg-background/70",
        disabled && "opacity-50 pointer-events-none",
      )}
      style={{ height: ITEM_HEIGHT * 3 }}
      role="listbox"
      aria-label={ariaLabel}
    >
      {/* Middle selection band */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 rounded-xl bg-primary/10 border border-primary/20"
        style={{ top: ITEM_HEIGHT, height: ITEM_HEIGHT }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="h-full overflow-y-scroll scroll-smooth no-scrollbar snap-y snap-mandatory"
        style={{
          scrollSnapType: "y mandatory",
          scrollPaddingTop: ITEM_HEIGHT,
          scrollPaddingBottom: ITEM_HEIGHT,
        }}
      >
        {/* Top spacer */}
        <div style={{ height: ITEM_HEIGHT }} aria-hidden />
        {options.map((opt) => {
          const isActive = String(opt) === String(value);
          return (
            <div
              key={String(opt)}
              className={cn(
                "flex items-center justify-center text-[17px] font-semibold tracking-tight tabular-nums snap-center select-none",
                isActive ? "text-foreground" : "text-muted-foreground/60",
              )}
              style={{ height: ITEM_HEIGHT }}
              role="option"
              aria-selected={isActive}
            >
              {opt}
            </div>
          );
        })}
        {/* Bottom spacer */}
        <div style={{ height: ITEM_HEIGHT }} aria-hidden />
      </div>
    </div>
  );
}

export function TimePickerWheel({ value, onChange, disabled, className }: TimePickerWheelProps) {
  const parsed = parse24(value) || { hour12: 9, minute: "00", period: "AM" as const };
  const hasValue = !!value;

  const update = (field: "hour" | "minute" | "period", val: string) => {
    const h = field === "hour" ? Number(val) : parsed.hour12;
    const m = field === "minute" ? val : parsed.minute;
    const p = (field === "period" ? (val as "AM" | "PM") : parsed.period);
    onChange(to24(h, m, p));
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-stretch gap-2">
        <Wheel
          ariaLabel="Hour"
          options={HOUR_OPTIONS}
          value={hasValue ? parsed.hour12 : null}
          onChange={(v) => update("hour", v)}
          disabled={disabled}
        />
        <div className="flex items-center text-2xl font-semibold text-muted-foreground">:</div>
        <Wheel
          ariaLabel="Minute"
          options={MINUTE_OPTIONS}
          value={hasValue ? parsed.minute : null}
          onChange={(v) => update("minute", v)}
          disabled={disabled}
        />
      </div>

      {/* AM/PM segmented toggle — chunky, easy thumb-tap */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-input bg-background/70 p-1">
        {(["AM", "PM"] as const).map((p) => {
          const active = hasValue ? parsed.period === p : false;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => update("period", p)}
              className={cn(
                "h-11 rounded-xl text-[15px] font-semibold tracking-tight transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TimePickerWheel;
