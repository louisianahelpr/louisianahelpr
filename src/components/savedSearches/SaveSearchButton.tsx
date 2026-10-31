import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { sameSearch, type SavedSearchSection, type SearchDraft } from "@/lib/savedSearches";
import { SaveSearchSheet } from "./SaveSearchSheet";

/**
 * The "Save this search" pill (board 91) and its sheet, for /search and the
 * section Browse screens. Renders nothing without a signed-in member.
 */
export function SaveSearchButton({ draft, sections, userId }: { draft: SearchDraft; sections?: SavedSearchSection[]; userId: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  // BUY-54: once this search is saved (or found saved already), the pill says so and opens the list; other filters
  // make it "Save this search" again.
  const [saved, setSaved] = useState<SearchDraft | null>(null);
  if (!userId) return null;
  const isSaved = !!saved && sameSearch({ section: saved.section, query: saved.query, category: saved.category, min_budget: saved.minDollars,
    max_budget: saved.maxDollars, radius_miles: saved.radiusMiles }, sections ? { ...draft, section: saved.section } : draft);
  if (isSaved) {
    return (
      <Link
        to="/profile?tab=saved_searches"
        data-testid="search-saved"
        className="inline-flex self-start items-center gap-1.5 rounded-full px-4 min-h-[44px] border border-border font-sans font-semibold text-ds-13"
        style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
      >
        <Check className="w-4 h-4" aria-hidden />
        Search saved
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="save-search"
        // SS-8: self-start, so a flex column (Declutter Browse with no results) never stretches the pill full width.
        className="self-start inline-flex items-center gap-1.5 rounded-full px-4 min-h-[44px] border border-border font-sans font-semibold text-ds-13"
        style={{ background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
      >
        <Bell className="w-4 h-4" aria-hidden />
        Save this search
      </button>
      <SaveSearchSheet open={open} onOpenChange={setOpen} userId={userId} draft={draft} sections={sections} onSaved={setSaved} />
    </>
  );
}
