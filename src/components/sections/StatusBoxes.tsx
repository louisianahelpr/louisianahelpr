import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

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
 * Status boxes under a section's non-Browse tab (owner, 2026-10-19): tap one =
 * only that group shows (the box is highlighted); tap it again = every group.
 */
export function StatusBoxes<K extends string>({
  boxes,
  value,
  onToggle,
}: {
  boxes: readonly StatusBoxDef<K>[];
  value: K | null;
  onToggle: (k: K) => void;
}) {
  const active = boxes.find((b) => b.key === value);
  return (
    <div className="flex flex-col gap-2">
      {/* Below 360px the row tightens (gap 6px, box padding 2px, 10px label) so a whole
          word fits each box at 320 — "Needs you" / "Upcoming" were cut to "Needs y…" /
          "Upcomi…" (guard: src/test/activityTabLabelsFitAPhone.test.ts). */}
      <div className="grid gap-2 max-[359px]:gap-1.5" style={{ gridTemplateColumns: `repeat(${boxes.length}, minmax(0, 1fr))` }} role="group" aria-label="Filter by status">
        {boxes.map((b) => {
          const on = b.key === value;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              data-status-box={b.key}
              onClick={() => onToggle(b.key)}
              className={`btn-press rounded-2xl border px-1 max-[359px]:px-0.5 py-2.5 text-center min-w-0 transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
              }`}
            >
              <span className={`block text-ds-20 leading-6 font-bold ${!on && b.hot && b.count > 0 ? "text-[hsl(var(--accent-ink))]" : ""}`}>{b.count}</span>
              <span className={`block text-ds-11 max-[359px]:text-ds-10 max-[359px]:tracking-normal leading-4 mt-0.5 truncate ${on ? "" : "text-muted-foreground"}`} title={b.label}>{b.label}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-ds-13 text-muted-foreground px-1" aria-live="polite">
          {/* One line at 320 (the old "Showing only … · tap it again to show all" wrapped, leaving "all" alone). */}
          {active.count === 0 ? "Nothing in " : "Only "}
          <b className="text-foreground">{active.label}</b>
          {active.count === 0 ? " right now" : ""} · tap again for all
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
