import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { extrasAsColumns, sameSearch, type SavedSearchSection, type SearchDraft } from "@/lib/savedSearches";
import { loadModule, untilReload } from "@/lib/loadModule";
import { whenPageSettled } from "@/lib/routePrefetch";
import "@/lib/i18n/enSearch";
import { useLanguage } from "@/lib/i18n/language";

/**
 * The sheet loads on its own (Q2705, 2026-11-14): imported statically, it and the shared sheet's dialog code rode in
 * every guest /declutter's first round (Declutter Browse draws this pill), though a guest never gets the pill. A member
 * starts it once the page has settled, so the first tap finds it loaded; the sheet mounts on that first tap.
 * Guard: src/boot/declutterGuestSkipsMemberCode.test.ts.
 */
const loadSheet = () => loadModule(() => import("./SaveSearchSheet"));
const SaveSearchSheet = lazy(() => loadSheet().then((m) => (m ? { default: m.SaveSearchSheet } : untilReload())));

/**
 * The "Save this search" pill (board 91) and its sheet, for /search and the
 * section Browse screens. Renders nothing without a signed-in member.
 */
export function SaveSearchButton({ draft, sections, userId }: { draft: SearchDraft; sections?: SavedSearchSection[]; userId: string | null | undefined }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // BUY-54: once this search is saved (or found saved already), the pill says so and opens the list; other filters
  // make it "Save this search" again.
  const [saved, setSaved] = useState<SearchDraft | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!userId) return;
    return whenPageSettled(() => void loadSheet().catch(() => {
      // A failed warm-up is not an error: the sheet's own lazy load tries again, and reports, on the tap.
    }));
  }, [userId]);
  if (!userId) return null;
  const isSaved = !!saved && sameSearch({ section: saved.section, query: saved.query, category: saved.category, min_budget: saved.minDollars,
    max_budget: saved.maxDollars, radius_miles: saved.radiusMiles, ...extrasAsColumns(saved.extras) }, sections ? { ...draft, section: saved.section } : draft);
  if (isSaved) {
    return (
      <Link
        to="/profile?tab=saved_searches"
        data-testid="search-saved"
        className="inline-flex self-start items-center gap-1.5 rounded-full px-4 min-h-[44px] border border-border font-sans font-semibold text-ds-13"
        style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
      >
        <Check className="w-4 h-4" aria-hidden />
        {t("srch.savedPill")}
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => { setAsked(true); setOpen(true); }}
        data-testid="save-search"
        // SS-8: self-start, so a flex column (Declutter Browse with no results) never stretches the pill full width.
        className="self-start inline-flex items-center gap-1.5 rounded-full px-4 min-h-[44px] border border-border font-sans font-semibold text-ds-13"
        style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
      >
        <Bell className="w-4 h-4" aria-hidden />
        {t("srch.save")}
      </button>
      {asked && <Suspense fallback={null}><SaveSearchSheet open={open} onOpenChange={setOpen} userId={userId} draft={draft} sections={sections} onSaved={setSaved} /></Suspense>}
    </>
  );
}
