import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { SAVED_SEARCHES_KEY } from "@/components/savedSearches/SaveSearchSheet";
import { fetchSavedSearches, resultsPath, SECTION_LABEL, type SavedSearch } from "@/lib/savedSearches";
import { JOB_CATEGORIES } from "@/lib/jobCategories";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";

/** How many saved searches the first screen lists; the rest stay in You › Settings › Saved searches. */
export const START_SAVED_MAX = 5;
/** How many categories each open section offers as a chip (each section's own picker order). */
export const START_CHIPS_PER_SECTION = 4;

/**
 * Q2645 (account audit 1102d row 4): /search with nothing typed was an empty page with one line, although the
 * member may have saved searches. It now lists the member's saved searches (each opens its results, as in
 * Settings) and a few categories of each open section (each opens that section's Browse on the category).
 * A saved search in a closed section is not offered, and Declutter's chips show only while Declutter is open.
 */
export function SearchStart({ userId, declutterOn }: { userId: string | null; declutterOn: boolean }) {
  // The same cache entry as Settings › Saved searches. A failed read shows no saved list (the chips and the box
  // still work); Settings shows the error and its retry.
  const saved = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "list", userId ?? ""], enabled: !!userId, queryFn: () => fetchSavedSearches(userId!) });
  const open = (s: SavedSearch) => s.section === "jobs" || (s.section === "declutter" && declutterOn);
  const rows = (saved.data ?? []).filter(open).slice(0, START_SAVED_MAX);
  const chips: { key: string; label: string; to: string }[] = [
    ...JOB_CATEGORIES.slice(0, START_CHIPS_PER_SECTION).map((c) => ({ key: `jobs-${c.value}`, label: c.label, to: `/jobs?tab=browse&cat=${c.value}` })),
    ...(declutterOn ? CATEGORIES.slice(0, START_CHIPS_PER_SECTION).map((c) => ({ key: `declutter-${c.key}`, label: c.label, to: `/declutter?cat=${c.key}` })) : []),
  ];

  return (
    <div className="space-y-4" data-testid="search-start">
      <p className="font-sans text-ds-13 text-muted-foreground px-1">Search every section at once.</p>
      {rows.length > 0 && (
        <section aria-label="Your saved searches" className="space-y-2">
          <h2 className="font-sans font-bold text-ds-15 px-1" style={{ color: "hsl(var(--ink-deep))" }}>Your saved searches</h2>
          <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))" }}>
            {rows.map((s) => (
              <Link key={s.id} to={resultsPath(s)} className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border last:border-b-0 ctl-tint">
                <Bookmark className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-ds-14 leading-snug truncate" style={{ color: "hsl(var(--ink-deep))" }}>{s.name}</span>
                  <span className="block font-sans text-ds-12 text-muted-foreground truncate">{SECTION_LABEL[s.section as keyof typeof SECTION_LABEL]}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section aria-label="Browse by category" className="space-y-2">
        <h2 className="font-sans font-bold text-ds-15 px-1" style={{ color: "hsl(var(--ink-deep))" }}>Browse by category</h2>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Link
              key={c.key}
              to={c.to}
              className="inline-flex items-center rounded-full px-4 min-h-[40px] border border-border font-sans font-semibold text-ds-13 ctl-tint"
              style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
