/**
 * The olive "3 new" pill (board 91) on a saved search: matches since the member last opened it
 * (saved_search_new_counts). Hidden at 0: every number is real or hidden. Settings › Saved searches and the Search
 * start screen (F259l, whole-app audit 2026-11-10) both show it.
 */
export function SavedSearchNewPill({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 font-sans font-semibold text-ds-11 tabular-nums" style={{ background: "hsl(var(--bark))", color: "hsl(var(--primary-foreground))" }} data-testid="saved-search-new">
      {n} new
    </span>
  );
}
