import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DateOfBirthPickerProps {
  /** ISO date string "YYYY-MM-DD" or "" */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

const daysInMonth = (year: number, month1to12: number) => {
  // month is 1-12; new Date(y, m, 0) returns last day of (m-1).
  return new Date(year, month1to12, 0).getDate();
};

const splitISO = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return { year: "", month: "", day: "" };
  return { year: m[1], month: m[2], day: m[3] };
};

/**
 * Friendly DOB picker — three Selects (Month · Day · Year). Holds partial
 * selections internally so a half-picked value (e.g. just Month) renders
 * back into the trigger instead of resetting to the placeholder. Emits a
 * full ISO date to the parent only when all three are set.
 */
export function DateOfBirthPicker({ value, onChange, id, className }: DateOfBirthPickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const maxYear = today.getFullYear() - 18;
  const minYear = today.getFullYear() - 100;

  const [parts, setParts] = React.useState(() => splitISO(value));

  // Re-sync from the parent value if it changes externally (e.g. profile
  // hydration in CompleteProfile). Skip when the value already matches our
  // composed string so user-driven partial selections aren't clobbered.
  React.useEffect(() => {
    const composed = parts.year && parts.month && parts.day
      ? `${parts.year}-${parts.month}-${parts.day}`
      : "";
    if (value !== composed) setParts(splitISO(value));
     
  }, [value]);

  const update = (patch: Partial<typeof parts>) => {
    setParts((prev) => {
      const next = { ...prev, ...patch };

      // Clamp day if the new month/year reduces the valid range.
      if (next.year && next.month && next.day) {
        const max = daysInMonth(Number(next.year), Number(next.month));
        if (Number(next.day) > max) next.day = pad(max);
      }

      // Emit only when all three parts are filled. Otherwise emit empty so
      // the form's required-validation still fires correctly on submit.
      if (next.year && next.month && next.day) {
        onChange(`${next.year}-${next.month}-${next.day}`);
      } else {
        onChange("");
      }

      return next;
    });
  };

  const years = React.useMemo(() => {
    const out: number[] = [];
    for (let y = maxYear; y >= minYear; y--) out.push(y);
    return out;
  }, [maxYear, minYear]);

  const dayCount = React.useMemo(() => {
    if (!parts.year || !parts.month) return 31;
    return daysInMonth(Number(parts.year), Number(parts.month));
  }, [parts.year, parts.month]);

  const triggerCls =
    "rounded-ds-md bg-background/60 border-border/70 h-11 text-ds-13 font-sans data-[placeholder]:text-muted-foreground";

  return (
    <div id={id} className={cn("grid grid-cols-[1.4fr_0.9fr_1fr] gap-2", className)}>
      <Select value={parts.month || undefined} onValueChange={(v) => update({ month: v })}>
        <SelectTrigger className={triggerCls} aria-label="Birth month">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {MONTHS.map((label, i) => (
            <SelectItem key={label} value={pad(i + 1)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={parts.day || undefined} onValueChange={(v) => update({ day: v })}>
        <SelectTrigger className={triggerCls} aria-label="Birth day">
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
            <SelectItem key={d} value={pad(d)}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={parts.year || undefined} onValueChange={(v) => update({ year: v })}>
        <SelectTrigger className={triggerCls} aria-label="Birth year">
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
