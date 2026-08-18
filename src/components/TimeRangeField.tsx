import { useState } from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePickerWheel } from "@/components/TimePickerWheel";
import { formatTime12 } from "@/components/TimePickerSelect";
import { cn } from "@/lib/utils";

interface TimeRangeFieldProps {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  disabled?: boolean;
  className?: string;
}

export function TimeRangeField({ start, end, onChange, disabled, className }: TimeRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"start" | "end">("start");

  // Compact display: drop the ":00" minutes so a full range
  // ("9 AM – 5 PM") fits the narrow pill in the availability row at
  // 375px instead of truncating the end time to "9:00 AM – 5:…".
  // The picker tabs below still show the full formatTime12 value.
  const compact = (t: string) => formatTime12(t).replace(":00", "");
  const display =
    start && end ? `${compact(start)} – ${compact(end)}` : "Set hours";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1.5 h-11 px-3 rounded-2xl border border-input glass-field text-ds-14 font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "opacity-50 pointer-events-none",
            className,
          )}
        >
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="truncate">{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        // Radix gives PopoverContent role="dialog", so without a name a screen
        // reader announces this hour picker as bare "dialog".
        aria-label="Choose start and end time"
        align="end"
        sideOffset={8}
        data-allow-scroll="true"
        onWheelCapture={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onTouchStartCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
        className="w-[300px] rounded-2xl p-4 space-y-4 touch-pan-y native-scroll-area"
      >
        <div className="grid grid-cols-2 gap-1 rounded-ds-md bg-secondary p-1">
          {(["start", "end"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-9 rounded-ds-sm text-ds-13 font-semibold capitalize transition-all",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "start" ? "Start" : "End"}
              <span className="ml-1.5 text-ds-11 font-normal text-muted-foreground tabular-nums">
                {formatTime12(t === "start" ? start : end)}
              </span>
            </button>
          ))}
        </div>

        {tab === "start" ? (
          <TimePickerWheel
            value={start}
            onChange={(v) => onChange({ start: v, end })}
          />
        ) : (
          <TimePickerWheel
            value={end}
            onChange={(v) => onChange({ start, end: v })}
          />
        )}

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full h-11 rounded-ds-md text-ds-15"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(var(--bark))",
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.01em",
            boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 6px 16px -4px hsl(var(--bark) / 0.30)",
          }}
        >
          Done
        </button>
      </PopoverContent>
    </Popover>
  );
}

export default TimeRangeField;
