import { Label } from "@/components/ui/label";
import { Check, Sparkles } from "lucide-react";
import { categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { categories } from "./detailsSectionConstants";

interface CategoryPickerProps {
  category: string;
  setCategory: (v: string) => void;
  autoCategoryArmedRef: React.MutableRefObject<boolean>;
  autoCategoryHint: string | null;
  setAutoCategoryHint: (v: string | null) => void;
}

export function CategoryPicker({
  category,
  setCategory,
  autoCategoryArmedRef,
  autoCategoryHint,
  setAutoCategoryHint,
}: CategoryPickerProps) {
  return (
    // Category first — picking it up front lets the title placeholder
    // and the description prompt below adapt to what's actually being
    // posted, which models a good, specific post.
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Category <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
        {autoCategoryHint && category === autoCategoryHint && (
          <button
            type="button"
            onClick={() => {
              // Acknowledge / dismiss — clears the pill. The category
              // stays where the smart-pick landed.
              autoCategoryArmedRef.current = false;
              setAutoCategoryHint(null);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold active:scale-95 transition-transform"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.12)",
              color: "hsl(var(--burnt-sienna))",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
            }}
            aria-label="Auto-selected from title — tap to dismiss"
          >
            <Sparkles className="w-3 h-3" aria-hidden />
            Auto-Selected from Title — Tap to Change
          </button>
        )}
      </div>
      {/* Compact horizontal chips — icon + label on one row, two
          columns. Cuts the category block from ~4 stacked rows of
          tall cards (~400px) to ~5 short rows (~240px) so the form
          doesn't bury the Photos + later sections under one picker.
          Active chip keeps the brand-color ring + adds a check so
          the selection reads instantly. */}
      <div id="category-picker" className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {categories.map((c) => {
          const colors = categoryColors[c.value];
          const active = category === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => {
                // Manual pick — disarm the smart-detect so a later
                // title edit doesn't quietly clobber the chosen
                // category, and clear any pending pill.
                autoCategoryArmedRef.current = false;
                setAutoCategoryHint(null);
                setCategory(c.value);
              }}
              aria-pressed={active}
              aria-label={c.label}
              className="flex items-center gap-2.5 p-2 rounded-ds-md transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={
                active
                  ? {
                      background: "hsl(var(--card))",
                      border: "0.5px solid hsl(var(--bark) / 0.35)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 0 0 2px hsl(var(--bark) / 0.18), " +
                        "0 6px 16px -4px hsl(var(--bark) / 0.22)",
                    }
                  : {
                      // These chips sit INSIDE the white Details card, not
                      // on the page — so they must be RECESSED to read as
                      // separate tiles. Fill with --parchment (the page /
                      // recessed tone, always darker than --card in BOTH
                      // themes: light 87% vs 98.5%, dark 9% vs 13%) so each
                      // box visibly sinks below the card surface. Filling
                      // with --card here paints the card's own colour
                      // (white-on-white) and the boxes vanish.
                      background: "hsl(var(--parchment))",
                      border: "0.5px solid hsl(var(--border) / 0.7)",
                      boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.3)",
                    }
              }
            >
              <span
                className={`relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${colors?.dot ?? ""}`}
                style={
                  !colors?.dot
                    ? { background: "hsl(var(--olivewood) / 0.12)" }
                    : undefined
                }
              >
                <CategoryIcon
                  category={c.value}
                  aria-hidden
                  className="w-3.5 h-3.5 text-white/90"
                  strokeWidth={2.25}
                />
                {/* The selected-state check rides the ICON as a badge instead
                    of sitting at the end of the row.
                    Inline it was a real flex item, so selecting a chip took
                    24px (icon + its gap) off the label: at 375 the label had
                    76.5px unselected and 52.5px selected, and "Yard Work"
                    (64.3px) rendered in full until you picked it and then
                    became "Yard …" — the one chip you had just chosen was
                    also the only one you could no longer read. There is no
                    room to buy here: the chips are 130.5px in a two-column
                    grid, and the longest label ("Storm Prep", 70.2px) needs
                    every pixel of the 76.5px the unselected state already
                    has. So the check stops taking width, and both states
                    lay out identically. */}
                {active && (
                  <span
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{
                      background: "hsl(var(--bark))",
                      boxShadow: "0 0 0 1.5px hsl(var(--card))",
                    }}
                    aria-hidden
                  >
                    <Check
                      className="w-2.5 h-2.5"
                      style={{ color: "hsl(var(--parchment))" }}
                      strokeWidth={3.5}
                    />
                  </span>
                )}
              </span>
              <span
                className="font-sans font-semibold leading-tight truncate text-ds-12"
                style={{
                  color: active ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.85)",
                }}
              >
                {c.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
