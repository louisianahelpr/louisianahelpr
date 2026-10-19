import { Label } from "@/components/ui/label";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import { categoryColors } from "@/components/job-card/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { SuggestCategory } from "@/components/SuggestCategory";
import { useEffect, useState } from "react";
import {
  JOB_CATEGORY_GROUPS,
  JOB_CATEGORY_LABELS,
  LICENSE_REQUIRED_CATEGORIES,
  jobCategoryGroupOf,
} from "@/lib/jobCategories";

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
  const [openGroup, setOpenGroup] = useState<string | null>(() => jobCategoryGroupOf(category)?.slug ?? null);
  // A category set from outside (the title smart-pick, a draft restore) opens
  // its own group.
  useEffect(() => {
    const g = jobCategoryGroupOf(category);
    if (g && g.items.length > 1) setOpenGroup(g.slug);
  }, [category]);
  const open = JOB_CATEGORY_GROUPS.find((g) => g.slug === openGroup) ?? null;
  const pick = (value: string) => {
    // Manual pick — disarm the smart-detect so a later title edit doesn't
    // quietly clobber the chosen category, and clear any pending pill.
    autoCategoryArmedRef.current = false;
    setAutoCategoryHint(null);
    setCategory(value);
  };
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
      {/* Two steps (owner 2026-10-19, the same picker as Shops): the main
          categories first, then the chosen one's subs open beneath them.
          The tiles keep the compact icon + label recipe below, two columns,
          and "Other" is one tap (it has no subs). The group holding the
          current category opens by itself, so a smart-picked category from
          the title is always visible. */}
      <div id="category-picker" className="space-y-2">
        <div role="group" aria-label="Main categories" className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {JOB_CATEGORY_GROUPS.map((g) => {
            const single = g.items.length === 1;
            const holdsChoice = (g.items as ReadonlyArray<string>).includes(category);
            return (
              <CategoryTile
                key={g.slug}
                iconCategory={g.icon}
                label={g.label}
                active={single ? category === g.items[0] : openGroup === g.slug || holdsChoice}
                expanded={single ? undefined : openGroup === g.slug}
                onClick={() => {
                  if (single) {
                    pick(g.items[0]);
                    setOpenGroup(null);
                  } else {
                    setOpenGroup(openGroup === g.slug ? null : g.slug);
                  }
                }}
              />
            );
          })}
        </div>
        {open && open.items.length > 1 && (
          <div
            role="group"
            aria-label={`${open.label} categories`}
            data-testid="category-subs"
            className="rounded-ds-md p-2 space-y-2"
            style={{ background: "hsl(var(--parchment) / 0.55)", border: "0.5px solid hsl(var(--border) / 0.6)" }}
          >
            <p className="px-1 text-ds-12 font-sans font-semibold" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {open.label}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {open.items.map((value) => (
                <CategoryTile
                  key={value}
                  iconCategory={value}
                  label={JOB_CATEGORY_LABELS[value]}
                  active={category === value}
                  onClick={() => pick(value)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {/* License-required category (owner 2026-10-19): the poster can post,
          and is told up front who can apply. The server enforces it. */}
      {LICENSE_REQUIRED_CATEGORIES[category as keyof typeof LICENSE_REQUIRED_CATEGORIES] && (
        <p
          role="note"
          data-testid="licensed-category-note"
          className="flex items-start gap-2 rounded-ds-md p-3 text-ds-12 font-sans leading-snug"
          style={{
            background: "hsl(var(--bark) / 0.07)",
            border: "0.5px solid hsl(var(--bark) / 0.25)",
            color: "hsl(var(--ink-deep))",
          }}
        >
          <ShieldCheck className="w-4 h-4 shrink-0 mt-px" style={{ color: "hsl(var(--bark))" }} aria-hidden />
          <span>
            <strong>Licensed pros only.</strong> Only Helprs with{" "}
            {LICENSE_REQUIRED_CATEGORIES[category as keyof typeof LICENSE_REQUIRED_CATEGORIES]} on file can apply.
          </span>
        </p>
      )}
      {/* I1: "Other" above always works; this sends a missing category to
          the admin queue (hidden switch suggest_category). */}
      <SuggestCategory area="jobs" />
    </div>
  );
}

interface CategoryTileProps {
  iconCategory: string;
  label: string;
  active: boolean;
  /** Set on a main-category tile: whether its subs are open. */
  expanded?: boolean;
  onClick: () => void;
}

/** One picker tile: icon dot + label, the recipe both steps share. */
function CategoryTile({ iconCategory, label, active, expanded, onClick }: CategoryTileProps) {
  const colors = categoryColors[iconCategory];
  return (
      <button
                      type="button"
        onClick={onClick}
        aria-pressed={expanded === undefined ? active : undefined}
        aria-expanded={expanded}
        aria-label={label}
        className="flex items-center gap-2.5 p-2 text-left rounded-ds-md transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            category={iconCategory}
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
              lay out identically.
              The trade labels (T1, 2026-10-15: "Auto & Small Engine",
              "Concrete & Masonry", "Pressure Washing") are wider than
              76.5px, so the label wraps to two lines (line-clamp-2)
              instead of truncating; the grid row grows to fit. */}
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
          className="font-sans font-semibold leading-tight line-clamp-2 break-words text-ds-12 text-left"
          style={{
            color: active ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.85)",
          }}
        >
          {label}
        </span>
      </button>
  );
}
