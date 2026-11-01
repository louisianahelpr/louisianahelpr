/**
 * The in-progress view while a listing goes up (owner 2026-11-01: after Post it / List N items the screen showed only a
 * greyed button, "not a blank screen"). One card: a title, a bar, and each thing in its step, Uploading photos ->
 * Checking -> Live. Sell one shows its one listing; Sell a bunch shows every item in the run. The done view is the
 * existing one (unchanged); this shows only while the work runs.
 */
import { useEffect, useRef } from "react";
import { Check, Loader2 } from "lucide-react";

export type ProgressStep = "waiting" | "photos" | "checking" | "live";

export const STEP_WORDS: Record<ProgressStep, string> = {
  waiting: "Waiting",
  photos: "Uploading photos",
  checking: "Checking",
  live: "Live",
};

/** Sell one: the step its post is at, from the words useSellFlowState says while posting. */
export function postStepOf(words: string | null): ProgressStep {
  if (!words) return "photos";
  if (/photo/i.test(words)) return "photos";
  if (/^Putting it up/i.test(words)) return "live";
  return "checking";
}

/**
 * Sell a bunch: each item's step from the run's progress. A run's steps are every item made ready (its photos up),
 * then every item listed (bunch.ts listingProgressLine): `done` of `total` = 2 per item.
 */
export function bunchItemSteps(done: number, total: number): ProgressStep[] {
  const n = Math.max(1, Math.round(total / 2));
  return Array.from({ length: n }, (_, i) => {
    if (done >= n + i + 1) return "live";
    if (done >= n) return done - n === i ? "checking" : "waiting";
    if (done > i) return "checking";
    return done === i ? "photos" : "waiting";
  });
}

/** How far along, 0..1, counting each item's three steps. */
function fraction(steps: readonly ProgressStep[]): number {
  if (steps.length === 0) return 0;
  const score: Record<ProgressStep, number> = { waiting: 0, photos: 0.25, checking: 0.6, live: 1 };
  return steps.reduce((t, s) => t + score[s], 0) / steps.length;
}

export function SellProgress({ title, rows, note }: { title: string; rows: { name: string; step: ProgressStep }[]; note?: string }) {
  const pct = Math.round(fraction(rows.map((r) => r.step)) * 100);
  // It appears under the button that was just tapped, often below the fold: bring it into view once.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, []);
  return (
    <section ref={ref} className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-label={title} data-sell-progress="">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--sage-ink))]" aria-hidden />
        <p className="min-w-0 flex-1 text-ds-15 font-semibold text-foreground" role="status" aria-live="polite">{title}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-[hsl(var(--bark))] transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 text-ds-14" data-progress-row={r.step}>
            <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
            <span className={`flex shrink-0 items-center gap-1 ${r.step === "live" ? "font-semibold text-[hsl(var(--sage-ink))]" : r.step === "waiting" ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
              {r.step === "live" && <Check className="h-4 w-4" aria-hidden />}
              {STEP_WORDS[r.step]}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="text-ds-13 text-muted-foreground">{note}</p>}
    </section>
  );
}

/**
 * Sell a bunch, while the photos are read and sorted (owner 2026-11-01: "show the photos as thumbnails with 'Reading
 * your photos…' and steps or a progress indicator"). The thumbnails are BunchIntake's, right under this.
 */
export function ReadingPhotos({ adding, sorting, found }: {
  adding: { ready: number; total: number } | null;
  sorting: { done: number; total: number };
  found: number;
}) {
  const added = !adding || adding.ready >= adding.total;
  const pct = Math.round(((adding && adding.total > 0 ? Math.min(1, adding.ready / adding.total) : 1) * 0.3 + (sorting.total > 0 ? sorting.done / sorting.total : 0) * 0.7) * 100);
  const steps: { name: string; state: "done" | "now" | "next" }[] = [
    { name: added ? "Photos added" : `Adding photos (${adding!.ready} of ${adding!.total})`, state: added ? "done" : "now" },
    { name: found > 0 ? `Sorting into items (${found} found so far)` : "Sorting into items", state: sorting.done >= sorting.total ? "done" : added || sorting.done > 0 ? "now" : "next" },
    { name: "Writing each listing", state: found > 0 ? "now" : "next" },
  ];
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-label="Reading your photos" data-reading-photos="">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--sage-ink))]" aria-hidden />
        <p className="min-w-0 flex-1 text-ds-15 font-semibold text-foreground">Reading your photos…</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Reading your photos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-[hsl(var(--bark))] transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.name} className={`flex items-center gap-2 text-ds-14 ${s.state === "next" ? "text-muted-foreground" : "text-foreground"}`} data-reading-step={s.state}>
            {s.state === "done" ? <Check className="h-4 w-4 shrink-0 text-[hsl(var(--sage-ink))]" aria-hidden /> : <span className={`h-2 w-2 shrink-0 rounded-full ${s.state === "now" ? "bg-[hsl(var(--bark))]" : "bg-muted-foreground/40"}`} aria-hidden />}
            <span className={s.state === "now" ? "font-semibold" : ""}>{s.name}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
