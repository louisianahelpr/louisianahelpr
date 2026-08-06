import { cn } from "@/lib/utils";
import type { DateRange } from "./types";

export const DateRangeBar = ({
  dateRange, setDateRange, customDays, setCustomDays,
}: {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customDays: number;
  setCustomDays: (n: number) => void;
}) => {
  const options: { id: DateRange; label: string }[] = [
    { id: "7d", label: "7d" },
    { id: "30d", label: "30d" },
    { id: "90d", label: "90d" },
    { id: "custom", label: "Custom" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex items-center rounded-ds-md bg-muted/60 p-0.5">
        {options.map((opt) => {
          const active = dateRange === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDateRange(opt.id)}
              className={cn(
                "px-2.5 h-7 rounded-md text-ds-11 font-semibold transition-colors tabular-nums",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {dateRange === "custom" && (
        <div className="inline-flex items-center gap-2 rounded-ds-md bg-muted/60 px-2 h-7">
          <label htmlFor="custom-days" className="text-ds-11 text-muted-foreground">
            Days
          </label>
          <input
            id="custom-days"
            type="number"
            min={1}
            max={365}
            value={customDays}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n > 0 && n <= 365) setCustomDays(n);
            }}
            className="w-14 h-9 px-1.5 text-ds-11 font-semibold tabular-nums rounded-sm bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
};
