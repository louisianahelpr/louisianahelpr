/**
 * The shared two-step category picker. Replaces long grouped native <select>s:
 * the panel first shows only the MAIN categories; tapping one expands its
 * subcategories beneath it (any other collapses); choosing a sub sets the value
 * and closes. The trigger reads "Main › Sub". The value is the sub's own slug,
 * exactly what the old <select> stored.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface CategoryPickerGroup {
  slug: string;
  label: string;
  items: { slug: string; label: string }[];
}

interface Props {
  id: string;
  value: string;
  onChange: (slug: string) => void;
  groups: CategoryPickerGroup[];
  placeholder?: string;
  /** Optional icon per main category. */
  groupIcon?: (groupSlug: string) => React.ReactNode;
}

function categoryTriggerText(groups: CategoryPickerGroup[], value: string): string | null {
  for (const g of groups) {
    const it = g.items.find((i) => i.slug === value);
    if (it) return `${g.label} › ${it.label}`;
  }
  return null;
}

export function TwoStepCategoryPicker({ id, value, onChange, groups, placeholder = "Choose a category", groupIcon }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const chosen = categoryTriggerText(groups, value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setExpanded(groups.find((g) => g.items.some((i) => i.slug === value))?.slug ?? null);
    setOpen((o) => !o);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={chosen ? "text-foreground" : "text-muted-foreground"}>{chosen ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-input bg-background p-1 shadow-md">
          {groups.map((g) => {
            const isOpen = expanded === g.slug;
            const regionId = `${panelId}-${g.slug}`;
            return (
              <div key={g.slug}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={regionId}
                  onClick={() => setExpanded(isOpen ? null : g.slug)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-3 text-left text-base font-semibold sm:text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    {groupIcon?.(g.slug)}
                    {g.label}
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {isOpen && (
                  <ul id={regionId} className="pb-1 pl-3">
                    {g.items.map((c) => {
                      const on = c.slug === value;
                      return (
                        <li key={c.slug}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              onChange(c.slug);
                              setOpen(false);
                              triggerRef.current?.focus();
                            }}
                            className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-3 text-left text-base sm:text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {c.label}
                            {on && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
