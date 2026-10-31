import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createSavedSearch, fetchSavedSearches, sameSearch, savedSearchSaveError, defaultName, filterWords, SECTION_LABEL, type SavedSearchSection, type SearchDraft } from "@/lib/savedSearches";

export const SAVED_SEARCHES_KEY = ["saved-searches"] as const;

/**
 * "Save this search" (board 91, left). The search in plain words, then how to
 * be told: in the app (always on for a saved search) and email (a switch,
 * once a day, only when something new matched). Text messages are not offered
 * until text alerts exist (board 88).
 *
 * `sections`: when the search spans sections (/search with "All"), the member
 * picks which one the alert watches.
 */
export function SaveSearchSheet({
  open,
  onOpenChange,
  draft,
  sections,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SearchDraft;
  sections?: SavedSearchSection[];
  userId: string;
  /** BUY-54: the search is saved (now, or already), so the pill can say so. */
  onSaved?: (d: SearchDraft) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [section, setSection] = useState<SavedSearchSection>(draft.section);
  const [email, setEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setSection(draft.section);
      setEmail(true);
    }
  }, [open, draft.section]);

  const d = { ...draft, section };
  const line = filterWords({ section, category: d.category, min_budget: d.minDollars, max_budget: d.maxDollars, radius_miles: d.radiusMiles }, !!d.query.trim());
  const choices = sections && sections.length > 1 ? sections : null;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const toList = { label: "View", onClick: () => navigate("/profile?tab=saved_searches") };
    // BUY-54: the same search saved twice alerts twice and uses up the cap. The list is the Saved searches tab's own
    // read (one cache). If it can't be read, the save goes ahead: a duplicate is better than a search never saved.
    const mine = await qc.fetchQuery({ queryKey: [...SAVED_SEARCHES_KEY, "list", userId], queryFn: () => fetchSavedSearches(userId) })
      .catch((err: unknown) => { report(err, { tags: { source: "SaveSearchSheet.sameSearch" } }); return null; });
    if (mine?.some((s) => sameSearch(s, d))) {
      setSaving(false);
      toast("You already saved this search", { description: "Find it in You › Settings › Saved searches.", action: toList });
      onSaved?.(d);
      onOpenChange(false);
      return;
    }
    try {
      await createSavedSearch(userId, d, email);
    } catch (err) {
      setSaving(false);
      report(err, { tags: { source: "SaveSearchSheet.save" } });
      hapticError();
      toast.error(savedSearchSaveError(err, "We couldn't save your search. Please try again."));
      return;
    }
    setSaving(false);
    hapticSuccess();
    void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
    // NIGHT-SAVEDS1-SS-2: toast.success renders nothing (toastPolicy); the bare toast() does, with a way to the list.
    toast("Search saved", {
      description: "Find it in You › Settings › Saved searches.",
      action: toList,
    });
    onSaved?.(d);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" floor data-testid="save-search-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHero title="Save this search" />

        {choices && (
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Which section">
            {choices.map((s) => {
              const on = s === section;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSection(s)}
                  className={`rounded-full px-4 min-h-[44px] font-sans font-semibold text-ds-13 ${on ? "btn-grad-primary" : "border border-border"}`}
                  style={on ? undefined : { background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
                >
                  {SECTION_LABEL[s]}
                </button>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl px-4 py-3" style={{ background: "hsl(var(--card))" }} data-testid="save-search-summary">
          <p className="font-sans font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }}>{defaultName(d)}</p>
          {line.length > 0 && <p className="font-sans text-ds-13 text-muted-foreground truncate">{line.join(" · ").replace(/^./, (c) => c.toUpperCase())}</p>}
        </div>

        <h3 className="mt-4 mb-2 px-1 font-sans font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>Tell me about new matches by</h3>
        <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))" }}>
          <div className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border">
            <span className="flex-1 min-w-0">
              <span className="block font-sans font-semibold text-ds-15">In the app</span>
              <span className="block font-sans text-ds-13 text-muted-foreground">Follows New matches in your notification settings</span>
            </span>
            <span className="font-sans font-semibold text-ds-13 text-muted-foreground">On</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
            <span className="flex-1 min-w-0">
              <span className="block font-sans font-semibold text-ds-15">Email</span>
              <span className="block font-sans text-ds-13 text-muted-foreground">Once a day, only if there's something new</span>
            </span>
            <Switch checked={email} onCheckedChange={setEmail} aria-label="Email" data-testid="save-search-email" />
          </div>
        </div>

        <SheetFooter className="mt-4">
          <SheetPrimaryAction onClick={() => void save()} disabled={saving} aria-busy={saving}>
            Save search
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
