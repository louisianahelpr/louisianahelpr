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
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${boxes.length}, minmax(0, 1fr))` }} role="group" aria-label="Filter by status">
        {boxes.map((b) => {
          const on = b.key === value;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              data-status-box={b.key}
              onClick={() => onToggle(b.key)}
              className={`btn-press rounded-2xl border px-1 py-2.5 text-center min-w-0 transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
              }`}
            >
              <span className={`block text-[20px] leading-6 font-bold ${!on && b.hot && b.count > 0 ? "text-[hsl(var(--accent-ink))]" : ""}`}>{b.count}</span>
              <span className={`block text-[11px] leading-4 mt-0.5 truncate ${on ? "" : "text-muted-foreground"}`}>{b.label}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-[13px] text-muted-foreground px-1" aria-live="polite">
          Showing only <b className="text-foreground">{active.label}</b> · tap it again to show all
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
        <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 text-foreground/70">{count}</span>}
        </h2>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="text-[13px] font-semibold text-primary">
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
        <span className="block text-[15px] font-semibold truncate">{title}</span>
        {meta && <span className="block text-[13px] text-muted-foreground truncate mt-0.5">{meta}</span>}
        {note && <span className="block text-[13px] text-[hsl(var(--accent-ink))] truncate mt-0.5">{note}</span>}
      </span>
      {right ?? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />}
    </button>
  );
}
