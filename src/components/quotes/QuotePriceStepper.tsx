import { Minus, Plus } from "lucide-react";
import { useFeature } from "@/hooks/useFeature";
import { useApplyTakeHome } from "@/components/dashboard/applyConfirmDialog/applyTakeHome";
import { formatPriceFloor } from "@/lib/format";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT } from "@/lib/helprFlatFee";
import type { EnrichedJob } from "@/components/dashboard/types";

const STEP = 5;

/**
 * Board 43 (Send a quote): the price as a big rust number with − / +, and,
 * under it, what the Helpr takes home if the quote is booked at that price.
 *
 * The take-home is useApplyTakeHome's (the apply sheet's own figure: the
 * job's Helpr fee, the one-time setup fee on a first payout, floored to the
 * dollar the transfer pays), on the fee model a quote job is booked on today:
 * the flat 5% + 70c (create-payment stamps it while 'jobs_poster_fee' is off).
 * When that switch is on for this member the model can differ, so the
 * take-home is hidden rather than guessed (truth rule).
 */
export function QuotePriceStepper({
  value,
  onChange,
  min,
  max,
}: {
  /** The typed whole-dollar string the form keeps. */
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
  const step = (d: number) => {
    const base = valid ? n : d > 0 ? min - STEP : max + STEP;
    onChange(String(Math.min(max, Math.max(min, base + d))));
  };
  const btn = "h-12 w-12 shrink-0 rounded-full border border-border bg-card inline-flex items-center justify-center disabled:opacity-40";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-4">
        <button type="button" className={btn} aria-label={`$${STEP} less`} disabled={valid && n <= min} onClick={() => step(-STEP)}>
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <span className="inline-flex items-baseline text-[hsl(var(--burnt-sienna))]">
          <span className="text-ds-32 font-bold" aria-hidden>$</span>
          <input
            id="quote-price"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Your price in whole dollars"
            className="w-[4.5ch] bg-transparent text-center text-ds-40 font-bold tabular-nums text-[hsl(var(--burnt-sienna))] outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-ds-sm"
            placeholder="0"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          />
        </span>
        <button type="button" className={btn} aria-label={`$${STEP} more`} disabled={valid && n >= max} onClick={() => step(STEP)}>
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {valid && <TakeHomeNote dollars={n} />}
    </div>
  );
}

function TakeHomeNote({ dollars }: { dollars: number }) {
  const posterFeeModel = useFeature("jobs_poster_fee");
  // A one-Helpr job on the flat model, the shape a booked quote becomes.
  const job = { budget: dollars, is_group_job: false, helpers_needed: 1, urgent_fee: null, helper_fee_flat_cents: HELPR_FLAT_FEE_CENTS, helper_fee_percent: HELPR_FLAT_FEE_PERCENT } as unknown as EnrichedJob;
  const { takeHome, firstPayoutFee } = useApplyTakeHome(job, HELPR_FLAT_FEE_PERCENT);
  if (posterFeeModel) return null;
  return (
    <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-quote-take-home="">
      You take home <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">${formatPriceFloor(takeHome)}</strong> after the Helpr fee (5% + 70¢)
      {firstPayoutFee > 0 ? " and the one-time setup fee" : ""} if this quote is booked. The money is held when it is booked and released when the job is confirmed done.
    </p>
  );
}
