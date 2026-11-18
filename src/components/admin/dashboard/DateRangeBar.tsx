import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import type { DateRange } from "./types";

export const DateRangeBar = ({
  dateRange, setDateRange, customDays, setCustomDays,
}: {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customDays: number;
  setCustomDays: (n: number) => void;
}) => {
  const options: SegmentedOption<DateRange>[] = [
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
    { value: "custom", label: "Custom" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <SegmentedControl
        ariaLabel="Date range"
        className="w-fit"
        options={options}
        value={dateRange}
        onChange={setDateRange}
        haptic={false}
      />
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
            inputMode="numeric"
            // Design audit area 10 #36 (11-18): the browser's number stepper sat half outside the pill; it is hidden
            // (the field takes typed digits) and the box is a little wider for three digits.
            className="w-16 h-9 px-2 text-center text-ds-11 font-semibold tabular-nums rounded-sm bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
      )}
    </div>
  );
};
