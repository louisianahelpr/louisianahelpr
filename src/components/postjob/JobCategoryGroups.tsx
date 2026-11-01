import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPostJob";
import type { MsgKey } from "@/lib/i18n/en";
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

/* A tile's title and examples are t("postJob.group.<id>") / t("postJob.groupEx.<id>"): their English is
 * groupTileLabel(g) and g.examples word for word (src/test/postJobInSpanish.test.tsx), so the shorter tile label
 * ("Moving & errands") stays one list with Edit profile's skill headings (jobCategoryGroups GROUP_TILE_LABEL). */

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
  // Post a job in Spanish (A3-3): the grid's words follow the member's language.
  const { t } = useLanguage();

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

  const tile = (key: string, icon: string, label: string, onClick: () => void, opts: { pressed?: boolean } = {}) => (
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
      </span>
    </button>
  );

  /**
   * A GROUP tile (owner, 2026-10-27: screen 2 "needs better organization"). Every group tile has the same
   * three parts: the icon, the title, and one short line of examples (jobCategoryGroups GROUP_EXAMPLES,
   * never past two lines). Every tile in the grid is the same height (.pj-group-tiles grid-auto-rows: 1fr).
   * The three parts are placed by index.css (.pj-group-tile): below a 560px column a small icon sits beside
   * the title and the examples run the tile's full width under both (a 163px phone tile has no room for
   * them beside a 40px icon); from 560px the 40px icon sits beside the title and the examples (one line).
   */
  const groupTile = (g: (typeof JOB_CATEGORY_GROUPS)[number]) => {
    const pressed = g.items.some((it) => it.value === category);
    return (
      <button
        key={g.id}
        type="button"
        aria-pressed={pressed}
        data-group-tile=""
        onClick={() => (g.items.length === 1 ? pick(g.items[0].value) : setGroup(g.id))}
        // The same olive OUTLINE for a group that holds the pick as the category tiles above (board 166).
        className={`pj-group-tile rounded-2xl bg-card text-left font-sans text-foreground leading-tight break-normal hyphens-none transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${pressed ? "border-2 !border-primary" : "border border-border"}`}
      >
        <span data-tile-icon="" className="inline-flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bark)/0.12)] leading-none" aria-hidden>
          {GROUP_EMOJI[g.id]}
        </span>
        <span data-tile-title="" className="block min-w-0 text-ds-15 font-semibold">{t(`postJob.group.${g.id}` as MsgKey)}</span>
        <span data-tile-sub="" title={t(`postJob.groupEx.${g.id}` as MsgKey)} className="block min-w-0 line-clamp-2 text-ds-13 font-normal text-muted-foreground">{t(`postJob.groupEx.${g.id}` as MsgKey)}</span>
      </button>
    );
  };
  const categoryTile = (it: { value: string; label: string }) =>
    tile(it.value, categoryEmoji(it.value), it.label, () => pick(it.value), { pressed: category === it.value });

  const open = group ? JOB_CATEGORY_GROUPS.find((g) => g.id === group) : null;
  // ONE category-picker element (A0-L1): useJobSubmit's scrollToField("category-picker") finds it in either view.
  return (
    <div id="category-picker" className={open ? "pj-cq" : "pj-cq space-y-5"}>
      {open ? (
        <section aria-label={t("postJob.inGroup", { group: t(`postJob.group.${open.id}` as MsgKey) })} className="pj-tiles grid gap-2.5">
          {open.items.map(categoryTile)}
        </section>
      ) : (
        <>
          <label className="flex min-h-[52px] items-center gap-3 rounded-full border border-border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t("postJob.searchCategories")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("postJob.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent font-sans text-ds-16 text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </label>

          {matches ? (
            <section aria-label={t("postJob.matchingCategories")} className="space-y-2.5">
              <h2 className="font-sans text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("postJob.matches")}</h2>
              {matches.length > 0 ? (
                <div className="pj-tiles grid gap-2.5">{matches.map(categoryTile)}</div>
              ) : (
                <p className="font-sans text-ds-14 text-muted-foreground">
                  {t("postJob.noMatch", { query: query.trim() })}
                </p>
              )}
            </section>
          ) : null}

          <section aria-label={t("postJob.categoryGroups")} className="pj-group-tiles grid gap-2.5">
            {JOB_CATEGORY_GROUPS.map(groupTile)}
          </section>

          {/* I1: "Other" always works; this sends a missing category to the admin
              queue (hidden switch suggest_category). */}
          <SuggestCategory area="jobs" />
        </>
      )}
    </div>
  );
}

