import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";

/**
 * A Browse filter as ONE slim row (owner, 2026-10-19: no row of pills at the
 * top of a section). The row names the current choice; the sliders icon wears
 * a count badge while a choice is active; a tap opens a slide-up sheet with
 * every choice. Used where a section has no search to share the row with.
 */
export function ChoiceFilterRow<T extends string>({
  title,
  allLabel,
  value,
  options,
  onChange,
}: {
  title: string;
  allLabel: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const pick = (v: T | null) => {
    onChange(v);
    setOpen(false);
  };
  const rows: { value: T | null; label: string }[] = [{ value: null, label: allLabel }, ...options];
  return (
    <>
      <button
        type="button"
        data-testid="choice-filter-row"
        onClick={() => setOpen(true)}
        aria-label={current ? `${title}: ${current.label}. Change` : `${title}: ${allLabel}. Change`}
        className="btn-press flex items-center gap-2 h-10 pl-3.5 pr-1 rounded-full border border-border bg-card text-left"
      >
        <span className="flex-1 min-w-0 truncate text-ds-15">{current ? current.label : allLabel}</span>
        <span className={`relative w-8 h-8 rounded-full flex items-center justify-center ${current ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]" : "text-muted-foreground"}`}>
          <SlidersHorizontal className="w-[18px] h-[18px]" aria-hidden />
          {current && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">1</span>}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetHero title={title} />
          <ul className="liquid-glass overflow-hidden" role="radiogroup" aria-label={title}>
            {rows.map((r, i) => {
              const on = r.value === value;
              return (
                <li key={r.value ?? "all"}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pick(r.value)}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left text-ds-15 ${i === rows.length - 1 ? "" : "border-b border-border/70"} ${on ? "font-semibold" : ""}`}
                  >
                    {r.label}
                    {on && <Check className="w-4 h-4 text-primary" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
