import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Clock } from "lucide-react";
import { SAVED_SEARCHES_KEY } from "@/components/savedSearches/SaveSearchSheet";
import { SavedSearchNewPill } from "@/components/savedSearches/SavedSearchNewPill";
import { fetchNewCounts, fetchSavedSearches, markSeen, resultsPath, type SavedSearch } from "@/lib/savedSearches";
import { report } from "@/lib/errorLogger";
import { JOB_CATEGORIES } from "@/lib/jobCategories";
import { CATEGORIES } from "@/lib/declutter/categoryIcons";
import { getRecentSearches } from "@/lib/searchHistory";
import { SEARCH_PARAM } from "@/components/landing/heroSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import "@/lib/i18n/enSearch";
import "@/lib/i18n/enDeclutter";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

/** How many saved searches the first screen lists; the rest stay in You › Settings › Saved searches. */
const START_SAVED_MAX = 5;
/** How many categories each open section offers as a chip (each section's own picker order). */
// F223 (audit 11-10): five, so Jobs offers Errands as Browse does (cleaning, yard work, handyman, moving, errands).
const START_CHIPS_PER_SECTION = 5;

/**
 * Q2645 (account audit 1102d row 4): /search with nothing typed was an empty page with one line, although the
 * member may have saved searches. It now lists the member's saved searches (each opens its results, as in
 * Settings) and a few categories of each open section (each opens that section's Browse on the category).
 * A saved search in a closed section is not offered, and Declutter's chips show only while Declutter is open.
 * F142 (owner UI audit 11-09: "Only 8 mixed category chips under a full-width box. Group chips under 'Jobs' and
 * 'Declutter'; show recent searches"): the member's recent searches (searchHistory, this device) come first, each
 * running again, and the category chips sit under a "Jobs" and a "Declutter" heading.
 */
/**
 * L004 (landing audit 11-09): a guest's Jobs chip went to /jobs?tab=browse (signed-in only), so it hit the login wall.
 * Signed out it opens the public board on that category (/browse?cat=, the address HireTownPage already uses).
 */
function jobsCategoryHref(cat: string, signedIn: boolean): string {
  return signedIn ? `/jobs?tab=browse&cat=${cat}` : `/browse?cat=${cat}`;
}

export function SearchStart({ userId, declutterOn, signedIn = true }: { userId: string | null; declutterOn: boolean; signedIn?: boolean }) {
  const { t } = useLanguage();
  // The same cache entry as Settings › Saved searches. A failed read shows no saved list (the chips and the box
  // still work); Settings shows the error and its retry.
  const saved = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "list", userId ?? ""], enabled: !!userId, queryFn: () => fetchSavedSearches(userId!) });
  const open = (s: SavedSearch) => s.section === "jobs" || (s.section === "declutter" && declutterOn);
  const rows = (saved.data ?? []).filter(open).slice(0, START_SAVED_MAX);
  // F259l (whole-app audit 2026-11-10): each row says how many new matches it has, from the same count and cache entry
  // as Settings › Saved searches; opening one marks it seen there too, so the count never goes stale.
  const qc = useQueryClient();
  const counts = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "counts", userId], enabled: !!userId && rows.length > 0, queryFn: fetchNewCounts, staleTime: 30_000 });
  const openSaved = (s: SavedSearch) => {
    if (!userId || !(counts.data?.get(s.id) ?? 0)) return;
    markSeen(userId, s.id)
      .then(() => qc.invalidateQueries({ queryKey: [...SAVED_SEARCHES_KEY, "counts"] }))
      .catch((err: unknown) => {
        // The results still open; only the "new" count stays as it was (as in Settings).
        report(err, { tags: { source: "SearchStart.markSeen" } });
      });
  };
  const groups: { key: string; title: string; chips: { key: string; label: string; to: string }[] }[] = [
    { key: "jobs", title: t("nav.jobs"), chips: JOB_CATEGORIES.slice(0, START_CHIPS_PER_SECTION).map((c) => ({ key: `jobs-${c.value}`, label: c.label, to: jobsCategoryHref(c.value, signedIn) })) },
    ...(declutterOn ? [{ key: "declutter", title: t("nav.declutter"), chips: CATEGORIES.slice(0, START_CHIPS_PER_SECTION).map((c) => ({ key: `declutter-${c.key}`, label: t(`decl.cat.${c.key}` as MsgKey), to: `/declutter?cat=${c.key}` })) }] : []),
  ];
  // Read once per visit: the list only changes when a search is run, which leaves this screen.
  const [recent] = useState(getRecentSearches);
  // ONE PAINT (Q1816 / Q169; prod-audit run 43691657529, /search at 375, page-settle 0.063 at ~380 ms): the category
  // chips painted first and the saved searches (90px) then landed ABOVE them, moving them down 106px. The lists wait for
  // the member's saved searches (and their "N new" counts when there are any), at most ARRIVAL_CAP_MS; a failed read
  // counts as answered. Signed out there is nothing to wait for.
  const savedSettled = !userId || saved.isFetched || saved.isError;
  const countsSettled = rows.length === 0 || counts.isFetched || counts.isError;
  const ready = useArrivalGate(true, savedSettled && countsSettled);

  return (
    <div className="space-y-4" data-testid="search-start">
      <p className="font-sans text-ds-13 text-muted-foreground px-1">{t("srch.everySection")}</p>
      {!ready && <SearchStartBones groups={groups.length} />}
      {ready && (<>
      {recent.length > 0 && (
        <section aria-label={t("srch.recent")} className="space-y-2">
          <h2 className="font-sans font-bold text-ds-15 px-1" style={{ color: "hsl(var(--ink-deep))" }}>{t("srch.recent")}</h2>
          <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))" }}>
            {recent.map((r) => (
              <Link key={r} to={`/search?${SEARCH_PARAM}=${encodeURIComponent(r)}`} title={r} data-recent-search="" className="flex items-center gap-3 px-4 py-3 min-h-[48px] border-b border-border last:border-b-0 ctl-tint">
                <Clock className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0 font-sans text-ds-14 truncate" style={{ color: "hsl(var(--ink-deep))" }}>{r}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {rows.length > 0 && (
        <section aria-label={t("srch.saved")} className="space-y-2">
          <h2 className="font-sans font-bold text-ds-15 px-1" style={{ color: "hsl(var(--ink-deep))" }}>{t("srch.saved")}</h2>
          <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))" }}>
            {rows.map((s) => (
              <Link key={s.id} to={resultsPath(s)} title={`${s.name} · ${t(`nav.${s.section}` as MsgKey)}`} onClick={() => openSaved(s)} className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border last:border-b-0 ctl-tint">
                <Bookmark className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-ds-14 leading-snug truncate" style={{ color: "hsl(var(--ink-deep))" }}>{s.name}</span>
                  <span className="block font-sans text-ds-12 text-muted-foreground truncate">{t(`nav.${s.section}` as MsgKey)}</span>
                </span>
                <SavedSearchNewPill n={counts.data?.get(s.id) ?? 0} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <section aria-label={t("srch.byCategory")} className="space-y-2">
        <h2 className="font-sans font-bold text-ds-15 px-1" style={{ color: "hsl(var(--ink-deep))" }}>{t("srch.byCategory")}</h2>
        {groups.map((g) => (
          <div key={g.key} data-category-group={g.key} className="space-y-1.5">
            <h3 className="font-sans font-semibold text-ds-13 text-muted-foreground px-1">{g.title}</h3>
            <div className="flex flex-wrap gap-2">
              {g.chips.map((c) => (
                <Link
                  key={c.key}
                  to={c.to}
                  className="inline-flex items-center rounded-full px-4 min-h-11 border border-border font-sans font-semibold text-ds-13 ctl-tint"
                  style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
      </>)}
    </div>
  );
}

/** The category section's shape while the saved searches answer: its heading, then each group's title and chip row. */
function SearchStartBones({ groups }: { groups: number }) {
  return (
    <div aria-hidden data-testid="search-start-loading" className="space-y-2">
      <Skeleton className="h-5 w-40 rounded" />
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="space-y-1.5">
          <Skeleton className="h-4 w-20 rounded" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: START_CHIPS_PER_SECTION }, (_, i) => <Skeleton key={i} className="h-11 w-24 rounded-full" />)}
          </div>
        </div>
      ))}
    </div>
  );
}
