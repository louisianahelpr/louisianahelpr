import { Link } from "react-router-dom";
import { Search } from "lucide-react";

/**
 * Explore's way into /search (board 89; lead 2026-10-21: "a search field at
 * the top of Explore, where people browse"). It looks like a field but is a
 * link: typing happens on /search, which searches every open section at once.
 * Each section's own Browse row (SectionSearchRow) still filters that section.
 */
export function ExploreSearchEntry() {
  return (
    <Link
      to="/search"
      data-testid="explore-search-entry"
      className="flex items-center gap-2 h-10 px-3.5 rounded-full border border-border text-muted-foreground font-sans text-ds-14 ctl-tint"
      style={{ background: "hsl(var(--card))" }}
    >
      <Search className="w-4 h-4 shrink-0" aria-hidden />
      <span className="truncate" title="Search all sections">Search all sections</span>
    </Link>
  );
}
