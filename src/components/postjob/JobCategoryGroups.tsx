import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { SuggestCategory } from "@/components/SuggestCategory";
import { GROUP_EMOJI, categoryEmoji } from "@/lib/categoryEmoji";
import { categoryFromTitle } from "@/lib/categoryFromTitle";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { JOB_CATEGORY_GROUPS, sentenceCaseLabel, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";


/**
 * Words people type that name the job, not the category ("e.g. wash my driveway", the box's own
 * example). Each offers every category it could mean; the poster taps the right one.
 */
const SEARCH_HINTS: [RegExp, JobCategory[]][] = [
  [/\b(?:driveway|sidewalk|siding|patio)\b/, ["pressure_washing", "concrete_masonry"]],
  [/\b(?:lawn|mow|weeds?|leaves|hedges?)\b/, ["yard_work"]],
  [/\b(?:furniture|boxes|haul)\b/, ["moving", "declutter_help"]],
];

/** Shorter tile labels where the group name wraps to three lines at 375 (lead 2026-10-21; the mock-up's own wording). */
const TILE_LABEL: Partial<Record<JobCategoryGroupId, string>> = { moving_errands: "Moving & errands" };

interface Props {
  category: string;
  setCategory: (v: string) => void;
  /** The group whose categories show (screen 1b), or null for the groups (screen 1). */
  group: JobCategoryGroupId | null;
  setGroup: (g: JobCategoryGroupId | null) => void;
  /** A category was tapped: go on to Details. The tap IS the choice (owner 2026-10-21). */
  onPicked: () => void;
}

/**
 * Post a Job screen 1 and 1b (owner 2026-10-21, mock-up helpr-postjob-flow-mockup.png).
 *
 * Screen 1: the search box, then exactly the 8 groups as 2-column tiles with an icon each. No
 * category list on this screen. A group with one category ("Something else" = Other) is that
 * category, so its tap goes straight on.
 * Screen 1b: that group's categories as tiles; a tap picks it and goes on. The page's back arrow
 * returns to the groups (usePostJobForm `categoryGroup`).
 *
 * Search matches category and group names, plus the keyword map the title auto-pick uses
 * (`categoryFromTitle`) and SEARCH_HINTS ("wash my driveway" offers Pressure washing and Concrete & masonry); a match is a tile, and its
 * tap goes on too. Nothing is picked without a tap.
 */
export function JobCategoryGroups({ category, setCategory, group, setGroup, onPicked }: Props) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const found = new Set<JobCategory>();
    const guess = categoryFromTitle(q);
    if (guess && guess in JOB_CATEGORY_LABELS) found.add(guess as JobCategory);
    for (const [re, cats] of SEARCH_HINTS) if (re.test(q)) cats.forEach((c) => found.add(c));
    for (const g of JOB_CATEGORY_GROUPS) {
      const groupHit = g.label.toLowerCase().includes(q);
      for (const it of g.items) {
        if (groupHit || it.label.toLowerCase().includes(q)) found.add(it.value);
      }
    }
    return [...found].map((value) => ({ value, label: sentenceCaseLabel(JOB_CATEGORY_LABELS[value]) }));
  }, [query]);

  const pick = (value: string) => {
    setCategory(value);
    onPicked();
  };

  const tile = (key: string, icon: string, label: string, onClick: () => void, opts: { pressed?: boolean; sub?: string } = {}) => (
    <button
      key={key}
      type="button"
      aria-pressed={opts.pressed}
      onClick={onClick}
      // A picked category (coming back to this screen) wears an olive OUTLINE, never a fill (board 166):
      // nothing on these screens is filled olive, the tap is the choice.
      className={`flex min-h-[72px] items-center gap-2.5 rounded-2xl bg-card px-3 py-3 text-left font-sans text-foreground transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${opts.pressed ? "border-2 !border-primary" : "border border-border"}`}
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bark)/0.12)] text-ds-20 leading-none" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 leading-tight break-normal hyphens-none">
        <span className="block text-ds-15 font-semibold">{label}</span>
        {opts.sub && <span className="mt-1 hidden text-ds-13 font-normal text-muted-foreground lg:block">{opts.sub}</span>}
      </span>
    </button>
  );
  const categoryTile = (it: { value: string; label: string }) =>
    tile(it.value, categoryEmoji(it.value), it.label, () => pick(it.value), { pressed: category === it.value });

  const open = group ? JOB_CATEGORY_GROUPS.find((g) => g.id === group) : null;
  if (open) {
    return (
      <div id="category-picker">
        <section aria-label={`In ${open.label}`} className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {open.items.map(categoryTile)}
        </section>
      </div>
    );
  }

  return (
    <div id="category-picker" className="space-y-5">
      <label className="flex min-h-[52px] items-center gap-3 rounded-full border border-border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Search categories</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. wash my driveway"
          className="min-w-0 flex-1 bg-transparent font-sans text-ds-16 text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </label>

      {matches ? (
        <section aria-label="Matching categories" className="space-y-2.5">
          <h2 className="font-sans text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Matches</h2>
          {matches.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">{matches.map(categoryTile)}</div>
          ) : (
            <p className="font-sans text-ds-14 text-muted-foreground">
              No category matches "{query.trim()}". Pick a group below, or Something else.
            </p>
          )}
        </section>
      ) : null}

      <section aria-label="Category groups" className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {JOB_CATEGORY_GROUPS.map((g) => {
          const holdsPick = g.items.some((it) => it.value === category);
          return tile(
            g.id,
            GROUP_EMOJI[g.id],
            TILE_LABEL[g.id] ?? g.label,
            () => (g.items.length === 1 ? pick(g.items[0].value) : setGroup(g.id)),
            { pressed: holdsPick, sub: g.items.length > 1 ? groupSample(g.items) : undefined },
          );
        })}
      </section>

      {/* I1: "Other" always works; this sends a missing category to the admin
          queue (hidden switch suggest_category). */}
      <SuggestCategory area="jobs" />
    </div>
  );
}

/** "Cleaning, handyman, assembly": the group's first three categories, in sentence case. */
function groupSample(items: readonly { label: string }[]): string {
  // Lower only a capital that starts an ordinary word ("Handyman" -> "handyman"), never an acronym ("HVAC").
  const names = items.slice(0, 3).map((it, i) => (i === 0 || /^[A-Z]{2}/.test(it.label) ? it.label : it.label.charAt(0).toLowerCase() + it.label.slice(1)));
  return items.length > 3 ? `${names.join(", ")} and more` : names.join(", ");
}
