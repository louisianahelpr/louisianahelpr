import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TimePickerSelectProps {
  value: string; // "HH:mm" 24h format
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const hours12 = Array.from({ length: 12 }, (_, i) => i === 0 ? 12 : i);
const minutes = ["00", "15", "30", "45"];

function parse24(time: string) {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const minute = String(m || 0).padStart(2, "0");
  // Snap to nearest 15-min
  const snapped = minutes.reduce((prev, curr) =>
    Math.abs(Number(curr) - Number(minute)) < Math.abs(Number(prev) - Number(minute)) ? curr : prev
  );
  return { hour12, minute: snapped, period };
}

function to24(hour12: number, minute: string, period: string) {
  let h = hour12;
  if (period === "AM" && h === 12) h = 0;
  if (period === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

export function TimePickerSelect({ value, onChange, disabled, className }: TimePickerSelectProps) {
  const parsed = parse24(value || "09:00");

  const update = (field: "hour" | "minute" | "period", val: string) => {
    const h = field === "hour" ? Number(val) : parsed.hour12;
    const m = field === "minute" ? val : parsed.minute;
    const p = field === "period" ? val : parsed.period;
    onChange(to24(h, m, p));
  };

  return (
    <div className={`flex items-center gap-1.5 ${className || ""}`}>
      <Select value={String(parsed.hour12)} onValueChange={(v) => update("hour", v)} disabled={disabled}>
        <SelectTrigger className="w-[65px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hours12.map((h) => (
            <SelectItem key={h} value={String(h)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground font-medium">:</span>
      <Select value={parsed.minute} onValueChange={(v) => update("minute", v)} disabled={disabled}>
        <SelectTrigger className="w-[65px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {minutes.map((m) => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={parsed.period} onValueChange={(v) => update("period", v)} disabled={disabled}>
        <SelectTrigger className="w-[65px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Format a "HH:mm" or "HH:mm:ss" time string to 12-hour display */
export function formatTime12(time: string | null | undefined): string {
  if (!time || time === "flexible") return "Flexible";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
