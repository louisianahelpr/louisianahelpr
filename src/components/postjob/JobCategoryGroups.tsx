import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SuggestCategory } from "@/components/SuggestCategory";
import { categoryFromTitle } from "@/lib/categoryFromTitle";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { JOB_CATEGORY_GROUPS, jobCategoryGroupOf, sentenceCaseLabel, type JobCategoryGroupId } from "@/lib/jobCategoryGroups";
import { CHIP, CHIP_ON, CHIP_OFF } from "@/components/ui/chipClasses";

interface Props {
  category: string;
  setCategory: (v: string) => void;
}


/**
 * Post a Job step 1 (board 23): search, then GROUPS that open their
 * categories as chips. One category is picked; the sticky Continue in
 * FormStep names it. Selected controls wear `btn-grad-primary` (CLAUDE.md).
 *
 * Search matches category and group names, plus the same keyword map the
 * title auto-pick uses (`categoryFromTitle`: "wash my driveway" finds
 * Pressure Washing). It never sets the category on its own; the poster taps.
 */
export function JobCategoryGroups({ category, setCategory }: Props) {
  const [openGroup, setOpenGroup] = useState<JobCategoryGroupId>(() => jobCategoryGroupOf(category) ?? "home");
  const [query, setQuery] = useState("");
  // A category can arrive after mount (a draft, a repost, a haul-away or
  // maintenance prefill): open its group so the picked chip is on screen.
  useEffect(() => {
    const g = jobCategoryGroupOf(category);
    if (g) setOpenGroup(g);
  }, [category]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const found = new Set<JobCategory>();
    const guess = categoryFromTitle(q);
    if (guess && guess in JOB_CATEGORY_LABELS) found.add(guess as JobCategory);
    for (const g of JOB_CATEGORY_GROUPS) {
      const groupHit = g.label.toLowerCase().includes(q);
      for (const it of g.items) {
        if (groupHit || it.label.toLowerCase().includes(q)) found.add(it.value);
      }
    }
    return [...found].map((value) => ({ value, label: sentenceCaseLabel(JOB_CATEGORY_LABELS[value]) }));
  }, [query]);

  const group = JOB_CATEGORY_GROUPS.find((g) => g.id === openGroup) ?? JOB_CATEGORY_GROUPS[0];

  const chip = (it: { value: string; label: string }) => {
    const on = category === it.value;
    return (
      <button
        key={it.value}
        type="button"
        aria-pressed={on}
        onClick={() => setCategory(it.value)}
        className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
      >
        {it.label}
      </button>
    );
  };

  return (
    <div id="category-picker" className="space-y-5">
      <label className="flex min-h-[52px] items-center gap-3 rounded-full border border-border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. wash my driveway"
          aria-label="Search categories"
          className="min-w-0 flex-1 bg-transparent font-sans text-ds-16 text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted-foreground">
            <X className="w-4 h-4" aria-hidden />
          </button>
        )}
      </label>

      {matches ? (
        <section aria-label="Matching categories" className="space-y-2.5">
          <h2 className="font-sans text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Matches</h2>
          {matches.length > 0 ? (
            <div className="flex flex-wrap gap-2">{matches.map(chip)}</div>
          ) : (
            <p className="font-sans text-ds-14 text-muted-foreground">
              No category matches "{query.trim()}". Open a group below, or pick Other under Something else.
            </p>
          )}
        </section>
      ) : null}

      <section aria-label="Category groups" className="space-y-2.5">
        <h2 className="font-sans text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Groups</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {JOB_CATEGORY_GROUPS.map((g) => {
            const on = g.id === group.id;
            return (
              <button
                key={g.id}
                type="button"
                aria-expanded={on}
                aria-controls="category-group-items"
                onClick={() => setOpenGroup(g.id)}
                className={`flex min-h-12 items-center rounded-ds-md px-4 py-2.5 text-left font-sans text-ds-15 font-semibold leading-tight break-normal hyphens-none transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${on ? "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]" : "bg-card border border-border text-foreground"}`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </section>

      <section
        id="category-group-items"
        aria-label={`In ${group.label}`}
        className="space-y-3 rounded-ds-lg border border-border bg-card p-4"
      >
        <h3 className="font-sans text-ds-14 font-bold text-foreground">In {group.label}</h3>
        <div className="flex flex-wrap gap-2">{group.items.map(chip)}</div>
      </section>

      {/* I1: "Other" always works; this sends a missing category to the admin
          queue (hidden switch suggest_category). */}
      <SuggestCategory area="jobs" />
    </div>
  );
}
