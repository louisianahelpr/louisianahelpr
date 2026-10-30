/**
 * The shared two-step category picker. Replaces long grouped native <select>s:
 * the panel first shows only the MAIN categories; tapping one expands its
 * subcategories beneath it (any other collapses); choosing a sub sets the value
 * and closes. The trigger reads "Main › Sub". The value is the sub's own slug,
 * exactly what the old <select> stored.
 *
 * The panel sits in the page's flow, so it never scrolls by itself: the sheet or page around it is the one scroller
 * (a 60vh cap here scrolled inside the Wanted sheet's own scroll, and ran 5px past the phone screen). Expanding a main
 * brings that main and its subs into view instead.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_SURFACE_CLS } from "./fieldSurface";

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
  /** A form whose fields differ from the shared <Input>'s size says so here, so the trigger still matches them. */
  triggerClassName?: string;
}

const SCROLL_MARGINS = "scroll-mt-20 scroll-mb-[calc(var(--bottom-nav-h,0px)+0.75rem)]";

function categoryTriggerText(groups: CategoryPickerGroup[], value: string): string | null {
  for (const g of groups) {
    const it = g.items.find((i) => i.slug === value);
    if (it) return `${g.label} › ${it.label}`;
  }
  return null;
}

export function TwoStepCategoryPicker({ id, value, onChange, groups, placeholder = "Choose a category", groupIcon, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
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

  // The expanded main with all its subs, or the panel when none is expanded; the margins clear the app's top bar and
  // the phone's bottom bar. `?.` on the call: not every test DOM has scrollIntoView.
  useEffect(() => {
    if (!open) return;
    (expandedRef.current ?? panelRef.current)?.scrollIntoView?.({ block: "nearest" });
  }, [open, expanded]);

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
        className={cn("flex min-h-12 w-full items-center justify-between gap-2 text-left", FIELD_SURFACE_CLS, triggerClassName)}
      >
        <span className={chosen ? "text-foreground" : "text-muted-foreground"}>{chosen ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div ref={panelRef} id={panelId} className={`mt-1 rounded-2xl border border-input bg-background p-1 shadow-md ${SCROLL_MARGINS}`}>
          {groups.map((g) => {
            const isOpen = expanded === g.slug;
            const regionId = `${panelId}-${g.slug}`;
            return (
              <div key={g.slug} ref={isOpen ? expandedRef : undefined} className={SCROLL_MARGINS}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={regionId}
                  onClick={() => setExpanded(isOpen ? null : g.slug)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-base font-semibold sm:text-sm ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-base sm:text-sm ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
