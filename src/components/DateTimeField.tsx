import { DatePickerField } from "@/components/DatePickerField";
import { TimePickerWheel } from "@/components/TimePickerWheel";

/**
 * A day and a time, on the app's own pickers (DatePickerField + TimePickerWheel,
 * the pair Post a Job and Edit job use), instead of the browser's bare
 * `datetime-local` box (lead review, boards 71/72/50). The value keeps the
 * `datetime-local` shape, "YYYY-MM-DDTHH:mm" in the device's time zone, or ""
 * until both halves are picked, so callers convert it exactly as before.
 */
export function DateTimeField({
  id,
  label,
  value,
  onChange,
  min,
}: {
  id: string;
  /** Names the day button; the time control is "<label>, time". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Earliest day, "YYYY-MM-DD" (defaults to today in DatePickerField). */
  min?: string;
}) {
  const [day = "", time = ""] = value.split("T");
  const set = (d: string, t: string) => onChange(d && t ? `${d}T${t}` : d ? `${d}T` : "");
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row" role="group" aria-label={label}>
      <DatePickerField id={id} value={day} min={min} onChange={(d) => set(d, time)} className="min-w-0 flex-1" />
      <TimePickerWheel value={time} onChange={(t) => set(day, t)} ariaLabel={`${label}, time`} className="min-w-0 flex-1" />
    </div>
  );
}
