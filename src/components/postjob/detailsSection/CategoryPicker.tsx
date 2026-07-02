import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Check, Sparkles, CloudLightning } from "lucide-react";
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
  // Hurricane season: June–Nov (months 5–10, 0-indexed). Used to surface
  // the Storm Prep seasonal pick above the regular category grid.
  const isHurricaneSeason = useMemo(() => {
    const month = new Date().getMonth();
    return month >= 5 && month <= 10;
  }, []);
  // During hurricane season the Storm pick lives in the seasonal banner
  // above the grid, so drop its grid chip to avoid showing Storm twice;
  // off-season it stays in the grid so the category is always reachable.
  const visibleCategories = useMemo(
    () =>
      isHurricaneSeason
        ? categories.filter((c) => c.value !== "storm_prep")
        : categories,
    [isHurricaneSeason],
  );

  return (
    // Category first — picking it up front lets the title placeholder
    // and the description prompt below adapt to what's actually being
    // posted, which models a good, specific post.
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Category <span className="text-destructive">*</span></Label>
        {autoCategoryHint && category === autoCategoryHint && (
          <button
            type="button"
            onClick={() => {
              // Acknowledge / dismiss — clears the pill. The category
              // stays where the smart-pick landed.
              autoCategoryArmedRef.current = false;
              setAutoCategoryHint(null);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-sans font-semibold active:scale-95 transition-transform"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.12)",
              color: "hsl(var(--burnt-sienna))",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
            }}
            aria-label="Auto-selected from title — tap to dismiss"
          >
            <Sparkles className="w-3 h-3" aria-hidden />
            Auto-selected from title — tap to change
          </button>
        )}
      </div>
      {/* Hurricane-season pick — only surfaces June–Nov.
          Appears above the grid so it's the first thing a poster sees
          during active season. Tapping it selects storm_prep just like
          tapping any chip in the grid below. */}
      {isHurricaneSeason && (
        <button
          type="button"
          onClick={() => {
            autoCategoryArmedRef.current = false;
            setAutoCategoryHint(null);
            setCategory("storm_prep");
          }}
          aria-pressed={category === "storm_prep"}
          aria-label="Storm — seasonal pick"
          className={`w-full rounded-ds-md p-2.5 flex items-center gap-2 transition-all active:scale-[0.97] border-[0.5px] ${
            category === "storm_prep"
              ? "bg-[hsl(210_35%_82%)] border-[hsl(210_30%_58%)] dark:bg-[hsl(210_30%_26%)] dark:border-[hsl(210_28%_46%)]"
              : "bg-[hsl(210_30%_92%)] border-[hsl(210_24%_78%)] dark:bg-[hsl(210_28%_18%)] dark:border-[hsl(210_24%_32%)]"
          }`}
        >
          <CloudLightning className="w-4 h-4 shrink-0 text-[hsl(210_45%_44%)] dark:text-[hsl(210_55%_70%)]" strokeWidth={2} />
          <span className="font-display italic font-semibold text-ds-14 leading-tight text-[hsl(210_28%_36%)] dark:text-[hsl(210_32%_80%)]">
            Storm
          </span>
          {category === "storm_prep" && (
            <Check className="w-3.5 h-3.5 ml-1 shrink-0 text-[hsl(210_45%_44%)] dark:text-[hsl(210_55%_70%)]" strokeWidth={3} />
          )}
          <span
            className="ml-auto text-ds-10 font-sans font-semibold uppercase px-1.5 py-0.5 rounded-ds-sm shrink-0 bg-[hsl(210_42%_78%)] text-[hsl(210_38%_30%)] dark:bg-[hsl(210_45%_32%)] dark:text-[hsl(210_55%_84%)]"
            style={{ letterSpacing: "0.06em" }}
          >
            In season
          </span>
        </button>
      )}

      {/* Compact horizontal chips — icon + label on one row, two
          columns. Cuts the category block from ~4 stacked rows of
          tall cards (~400px) to ~5 short rows (~240px) so the form
          doesn't bury the Photos + later sections under one picker.
          Active chip keeps the brand-color ring + adds a check so
          the selection reads instantly. */}
      <div id="category-picker" className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {visibleCategories.map((c) => {
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
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${colors?.dot ?? ""}`}
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
              </span>
              <span
                className="font-sans font-semibold leading-tight truncate"
                style={{
                  fontSize: "0.78rem",
                  color: active ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.85)",
                }}
              >
                {c.label}
              </span>
              {active && (
                <Check
                  className="w-3.5 h-3.5 ml-auto shrink-0"
                  style={{ color: "hsl(var(--bark))" }}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
