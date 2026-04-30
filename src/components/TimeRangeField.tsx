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

  const display =
    start && end ? `${formatTime12(start)} – ${formatTime12(end)}` : "Set hours";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-2 h-11 px-4 rounded-2xl border border-input bg-background/70 backdrop-blur-sm text-[14px] font-semibold tabular-nums text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "opacity-50 pointer-events-none",
            className,
          )}
        >
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="truncate">{display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        data-allow-scroll="true"
        onWheelCapture={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        className="w-[300px] rounded-2xl p-4 space-y-4 touch-pan-y"
      >
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          {(["start", "end"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-9 rounded-lg text-sm font-semibold capitalize transition-all",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "start" ? "Start" : "End"}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
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
          className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold"
        >
          Done
        </button>
      </PopoverContent>
    </Popover>
  );
}

export default TimeRangeField;
