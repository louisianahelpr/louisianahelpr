import { Check } from "lucide-react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";

/**
 * A Browse filter's slide-up sheet of choices (owner, 2026-10-19: no row of
 * pills at the top of a section; categories live in the filter sheet). It is
 * opened by the filter button inside the section's SectionSearchRow; a tap
 * picks and closes. Used by Shops (category).
 */
export function ChoiceSheet<T extends string>({
  open,
  onOpenChange,
  title,
  allLabel,
  value,
  options,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  allLabel: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T | null) => void;
}) {
  const pick = (v: T | null) => {
    onChange(v);
    onOpenChange(false);
  };
  const rows: { value: T | null; label: string }[] = [{ value: null, label: allLabel }, ...options];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
  );
}
