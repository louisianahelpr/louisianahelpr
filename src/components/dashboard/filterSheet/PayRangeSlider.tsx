import { hapticLight } from "@/lib/haptics";

/**
 * Board 24 "Price": a two-thumb range over the SAME min/max budget state the
 * list, the map, the server count and saved searches already read (`?min=` /
 * `?max=`, job.budget). Two native range inputs on one track, so each thumb
 * keeps the browser's own keyboard and screen-reader behaviour.
 *
 * The ends mean "no limit": the left end clears `min`, the right end clears
 * `max` and reads "$300+". It filters the job's price as posted, which is
 * what the caption says; a Helpr's card shows take-home after the fee.
 */
const STEP = 5;
const TOP = 300;

function toNumber(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function payRangeLabel(minBudget: string, maxBudget: string): string {
  if (!minBudget && !maxBudget) return "Any price";
  const lo = `$${toNumber(minBudget, 0)}`;
  if (!maxBudget) return `${lo}+`;
  return `${lo} – $${toNumber(maxBudget, TOP)}`;
}

export function PayRangeSlider({
  minBudget, setMinBudget, maxBudget, setMaxBudget,
}: {
  minBudget: string;
  setMinBudget: (v: string) => void;
  maxBudget: string;
  setMaxBudget: (v: string) => void;
}) {
  const lo = Math.min(toNumber(minBudget, 0), TOP - STEP);
  const hi = maxBudget ? Math.max(Math.min(toNumber(maxBudget, TOP), TOP), lo + STEP) : TOP;
  const pct = (v: number) => `${(v / TOP) * 100}%`;
  return (
    <div>
      <div className="range-dual" data-testid="pay-range">
        <div aria-hidden className="range-dual-track" />
        <div aria-hidden className="range-dual-fill" style={{ left: pct(lo), right: `calc(100% - ${pct(hi)})` }} />
        <input
          type="range"
          min={0}
          max={TOP}
          step={STEP}
          value={lo}
          aria-label="Lowest price"
          aria-valuetext={lo === 0 ? "No minimum" : `$${lo}`}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), hi - STEP);
            if (v === lo) return;
            hapticLight();
            setMinBudget(v <= 0 ? "" : String(v));
          }}
        />
        <input
          type="range"
          min={0}
          max={TOP}
          step={STEP}
          value={hi}
          aria-label="Highest price"
          aria-valuetext={hi >= TOP ? "No maximum" : `$${hi}`}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), lo + STEP);
            if (v === hi) return;
            hapticLight();
            setMaxBudget(v >= TOP ? "" : String(v));
          }}
        />
      </div>
      <p className="text-ds-11 text-muted-foreground leading-snug">The job's price as posted, before the Helpr's fee</p>
    </div>
  );
}
