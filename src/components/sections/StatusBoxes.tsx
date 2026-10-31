import { useCallback, useLayoutEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { CHIP, CHIP_ON, CHIP_OFF } from "@/components/ui/chipClasses";

export interface StatusBoxDef<K extends string> {
  key: K;
  label: string;
  count: number;
  /** A backlog the member should act on (rust number). */
  hot?: boolean;
}

/** The filter, read from `?status=`. null = every group shows. */
export function useStatusFilter<K extends string>(valid: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const value = raw && (valid as readonly string[]).includes(raw) ? (raw as K) : null;
  const toggle = useCallback(
    (k: K) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (p.get("status") === k) p.delete("status");
          else p.set("status", k);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [value, toggle] as const;
}

/**
 * The status chip row under a section's non-Browse tab (boards 14, 21; owner,
 * 2026-10-19 for the filter rule, spec v2 for the look). ONE row for every
 * section (Jobs, Declutter, Shops, Homes, the Home dashboard): "All" first,
 * then one chip per group with its count INSIDE ("Needs you · 2"; All only when
 * the caller knows the list's length). Tap a chip
 * = only that group shows; tap it again, or tap All = every group. A zero
 * count is not printed (truth rule: "Done", not "Done · 0"). The row scrolls
 * sideways, so a label is never cut. `hot` is kept for callers but no longer
 * paints a number: rust is for money only (spec §1.1).
 */
/** The fade at the row's end when a control is pinned there (one icon wide): `pr-11` and the mask below. */
const END_FADE_PX = 44;

/**
 * How far to scroll the chip track so the lit chip sits fully in view, clear of the end fade; 0 when it already
 * does. Audit A2-L18 (2026-10-29, 375 Posted): after a cancel left "Waiting" lit, it sat under the fade and the
 * search icon, cut to "Wait". Rects are the track's and the chip's getBoundingClientRect.
 */
export function revealDelta(track: { left: number; right: number }, chip: { left: number; right: number }, endFade: number): number {
  const over = chip.right - (track.right - endFade);
  if (over > 0) return Math.ceil(over);
  const under = chip.left - track.left;
  return under < 0 ? Math.floor(under) : 0;
}

/** The All chip's key: not a group, so it carries `data-status-all`, never `data-status-box`. */
const ALL = "\u0000all";

export function StatusBoxes<K extends string>({
  boxes,
  value,
  onToggle,
  allCount,
  end,
  emptyLine = true,
}: {
  boxes: readonly StatusBoxDef<K>[];
  value: K | null;
  onToggle: (k: K) => void;
  /** How many rows "All" shows. Only a caller whose list is exactly that many rows passes it; without it All has no number (the groups need not add up to the list). */
  allCount?: number;
  /** "Nothing in X right now" under the chips. Jobs passes false: its list's own empty card already says it (owner 2026-10-31, LEAD-SEARCH-BY-GEAR: the line showed twice). */
  emptyLine?: boolean;
  /**
   * A control pinned at the row's end, outside the sideways scroll. No section passes one today: Jobs' search moved up
   * beside the gear (owner 2026-10-31, LEAD-SEARCH-BY-GEAR), and with it went the open-field "only the lit chip" mode.
   */
  end?: ReactNode;
}) {
  const active = boxes.find((b) => b.key === value);
  const trackRef = useRef<HTMLDivElement>(null);
  const endFade = end ? END_FADE_PX : 0;
  // The lit chip is brought into view whenever the filter changes, and again when the chips change width (their
  // counts land after the first paint), so it is never left cut under the end fade (A2-L18).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reveal = () => {
      const lit = track.querySelector<HTMLElement>("[aria-pressed='true']");
      if (!lit) return;
      const d = revealDelta(track.getBoundingClientRect(), lit.getBoundingClientRect(), endFade);
      if (d !== 0) track.scrollLeft += d;
    };
    reveal();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    for (const c of Array.from(track.children)) ro?.observe(c);
    return () => ro?.disconnect();
  }, [value, endFade, boxes.length]);
  const chip =(key: string, label: string, count: number, on: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      {...(key === ALL ? { "data-status-all": "" } : { "data-status-box": key })}
      data-count={count}
      onClick={onClick}
      className={`${CHIP} shrink-0 whitespace-nowrap ${on ? CHIP_ON : CHIP_OFF}`}
    >
      <span data-chip-label="">{label}</span>
      {count > 0 && <span className="tabular-nums" data-chip-count="">{`\u00a0· ${count}`}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
      <div
        ref={trackRef}
        // With a control at the end, the row softly fades over its last 44px (one icon wide), so the chip that runs
        // under it reads as "more", never as clipped; the same 44px of end padding lets the last chip scroll fully
        // clear of the fade (lead, 390, 2026-10-25).
        className={`-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${end ? "pl-1 pr-11 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]" : "px-1"}`}
        role="group"
        aria-label="Filter by status"
      >
        {chip(ALL, "All", allCount ?? 0, value === null, () => { if (value !== null) onToggle(value); })}
        {boxes.map((b) => chip(b.key, b.label, b.count, b.key === value, () => onToggle(b.key)))}
      </div>
      {end}
      </div>
      {emptyLine && active && active.count === 0 && (
        <p className="text-ds-13 text-muted-foreground px-1" aria-live="polite">
          Nothing in <b className="text-foreground">{active.label}</b> right now
        </p>
      )}
    </div>
  );
}

/** A grouped list: uppercase header + count + optional "See all", then a flat card. */
export function GroupSection({
  title,
  count,
  onSeeAll,
  seeAllLabel = "See all",
  children,
}: {
  title: string;
  count?: number;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 text-foreground/70">{count}</span>}
        </h2>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="text-ds-13 font-semibold text-primary">
            {seeAllLabel}
          </button>
        )}
      </div>
      <div className="liquid-glass overflow-hidden">{children}</div>
    </section>
  );
}

/** One row inside a GroupSection card. */
export function GroupRow({
  title,
  meta,
  note,
  right,
  onClick,
  last,
  leading,
}: {
  title: ReactNode;
  meta?: ReactNode;
  note?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  last?: boolean;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-press w-full text-left flex items-center gap-3 px-4 py-3 ${last ? "" : "border-b border-border/70"}`}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-ds-15 font-semibold truncate" title={full(title)}>{title}</span>
        {meta && <span className="block text-ds-13 text-muted-foreground truncate mt-0.5" title={full(meta)}>{meta}</span>}
        {note && <span className="block text-ds-13 text-[hsl(var(--accent-ink))] truncate mt-0.5" title={full(note)}>{note}</span>}
      </span>
      {right ?? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />}
    </button>
  );
}

/** The full text of a clipped line, for its `title` (Q108), when the line is plain text. */
function full(n: ReactNode): string | undefined {
  return typeof n === "string" || typeof n === "number" ? String(n) : undefined;
}
