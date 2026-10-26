import { Link } from "react-router-dom";
import { Search } from "lucide-react";

/**
 * Explore's way into /search (board 89; lead 2026-10-21: "a search field at
 * the top of Explore, where people browse"). It looks like a field but is a
 * link: typing happens on /search, which searches every open section at once.
 * Each section's own Browse row (SectionSearchRow) still filters that section.
 */
export function ExploreSearchEntry({ variant = "field" }: { variant?: "field" | "icon" } = {}) {
  // THE ICON (owner 2026-10-25, Jobs Posted / Working at 1440: "i prefer the search not expanded"): the same
  // 40px ghost square as Browse's "Search jobs" button (BrowseTasksActions), at the end of the status chip row.
  // Guard: src/test/jobsSearchIsAnIcon.test.tsx.
  if (variant === "icon") {
    return (
      <Link
        to="/search"
        data-testid="explore-search-entry"
        aria-label="Search all sections"
        title="Search all sections"
        className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-ds-md btn-press text-muted-foreground ctl-tint hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <Search className="w-5 h-5" aria-hidden />
      </Link>
    );
  }
  return (
    <Link
      to="/search"
      data-testid="explore-search-entry"
      className="flex items-center gap-2 h-11 px-3.5 rounded-full border border-border text-muted-foreground font-sans text-ds-14 ctl-tint"
      style={{ background: "hsl(var(--card))" }}
    >
      <Search className="w-4 h-4 shrink-0" aria-hidden />
      <span className="truncate" title="Search all sections">Search all sections</span>
    </Link>
  );
}
