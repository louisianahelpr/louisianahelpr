/**
 * The Sell an item flow's presentational pieces (boards 31a, 48, 31b, 49, 158),
 * kept apart from DeclutterSellView (the flow's state and server calls) so
 * that file stays under the component-size threshold.
 */
import { formatPrice } from "@/lib/declutter/distance";
import { PRICE_DROP_RUN_UTC, dropStepCents } from "@/lib/declutter/priceDrop";

/** A step's Bodoni question and its one-line helper (spec §1.2, §3 "Step-by-step flows"). */
export function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="space-y-1">
      <h2 id="sell-step" className="font-display font-moment text-ds-32 font-semibold leading-tight text-foreground">{title}</h2>
      <p className="text-ds-14 text-muted-foreground">{sub}</p>
    </div>
  );
}

export function ChipGroup({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label={label}>
      <p className="text-ds-14 font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            // The selected look inline, with its declared ink, so the gradInkContrast resolver can rebuild it.
            className={`flex min-h-10 items-center rounded-full px-4 text-ds-13 font-semibold ${value === o.value ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StepperButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-ds-22 text-foreground disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

export function ReviewRow({ title, body, onEdit }: { title: string; body: string; onEdit?: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5" data-review-row={title}>
      <span className="min-w-0 flex-1">
        <span className="block text-ds-15 font-semibold text-foreground">{title}</span>
        <span className="block text-ds-13 text-muted-foreground">{body}</span>
      </span>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`} className="min-h-11 px-2 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">
          Edit
        </button>
      )}
    </li>
  );
}

/**
 * How long a listing stays up, as the code runs today (owner 2026-10-28, item 6). Measured 2026-10-28:
 * offers-mode listings have no end time (ends_at NULL, spec B13), relist_count is never written (row 47's
 * "relist up to 3 times" is an auction rule kept for when bidding opens), and no prod cron ends a live
 * listing by age (cron.job declutter-*: deadlines, handovers, money, pickup reminders, price drops, refund
 * requests, seller hidden, wanted, haul-away). A set length is an owner decision, never invented here.
 */
export const LISTING_LIFETIME = "Until it sells or you take it down. There's no end date.";

/** The real nightly run (priceDrop.ts PRICE_DROP_RUN_UTC) in Louisiana time: "6:07 PM" (CDT) or "5:07 PM" (CST). */
export function dropRunTime(now: Date = new Date()): string {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PRICE_DROP_RUN_UTC.hour, PRICE_DROP_RUN_UTC.minute));
  return run.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

/**
 * Board 31b's "If it doesn't sell" strip, from the REAL rule (priceDrop.ts):
 * each evening's drop is the seller's step (dropStepCents: their percent, down
 * to a whole dollar), never below the lowest price. The stop above the floor
 * is private even from the seller (B42), so the strip says the drops may stop
 * sooner; never a promised schedule.
 */
export function DropSchedule({ priceCents, floorCents, pct }: { priceCents: number | null; floorCents: number | null; pct: number }) {
  if (!priceCents || !floorCents || floorCents >= priceCents || floorCents < 100 || pct <= 0) return null;
  const steps: number[] = [];
  let cur = priceCents;
  while (steps.length < 6 && cur > floorCents) {
    cur = Math.max(floorCents, dropStepCents(cur, pct));
    steps.push(cur);
  }
  const max = priceCents;
  return (
    <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-drop-schedule="">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ds-14 font-semibold text-foreground">If it doesn't sell</p>
        <p className="text-ds-12 text-muted-foreground">{pct}% less each evening, {dropRunTime()}</p>
      </div>
      <ol className="flex items-end gap-1.5" aria-label="The lowest it could be each evening">
        {steps.map((c, i) => (
          <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              aria-hidden
              className={`w-full rounded-lg ${c === floorCents ? "bg-[hsl(var(--burnt-sienna))]" : "bg-[hsl(var(--burnt-sienna)/0.14)]"}`}
              style={{ height: `${Math.max(16, Math.round((c / max) * 56))}px` }}
            />
            <span className="text-ds-11 font-bold tabular-nums text-[hsl(var(--sienna-ink))]">{formatPrice(c)}</span>
          </li>
        ))}
      </ol>
      <p className="text-ds-12 text-muted-foreground">
        The first drop comes after it has been up 12 hours. It never goes below {formatPrice(floorCents)}, and may stop sooner.
      </p>
    </div>
  );
}
