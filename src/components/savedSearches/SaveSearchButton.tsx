import { useState } from "react";
import { Bell } from "lucide-react";
import type { SavedSearchSection, SearchDraft } from "@/lib/savedSearches";
import { SaveSearchSheet } from "./SaveSearchSheet";

/**
 * The "Save this search" pill (board 91) and its sheet, for /search and the
 * section Browse screens. Renders nothing without a signed-in member.
 */
export function SaveSearchButton({ draft, sections, userId }: { draft: SearchDraft; sections?: SavedSearchSection[]; userId: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!userId) return null;
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
      <SaveSearchSheet open={open} onOpenChange={setOpen} userId={userId} draft={draft} sections={sections} />
    </>
  );
}
