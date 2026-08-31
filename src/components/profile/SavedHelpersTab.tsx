// Saved Helpers — Profile tab version.
//
// Replaces the standalone /saved-helpers route. Shares the same data
// load + remove flow as the prior SavedHelpers page, but wraps the
// content in the standard Profile shell (ProfileTabHeader + tab
// container) so the back button, top padding, and dock alignment
// stay consistent with every other Profile sub-tab.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Search, ArrowUpDown, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { sortOptions } from "@/components/profile/savedHelpersTab/types";
import type { SavedHelpersTabProps } from "@/components/profile/savedHelpersTab/types";
import { useSavedHelpers } from "@/components/profile/savedHelpersTab/useSavedHelpers";
import { SavedHelperCard } from "@/components/profile/savedHelpersTab/SavedHelperCard";

const CATEGORY_FILTER_OPTIONS = Object.entries(JOB_CATEGORY_LABELS) as [JobCategory, string][];

export function SavedHelpersTab({ onBack }: SavedHelpersTabProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const {
    helpers,
    loading,
    loadError,
    wasOffline,
    search,
    setSearch,
    sortBy,
    setSortBy,
    categoryFilter,
    setCategoryFilter,
    editingNoteFor,
    noteDraft,
    setNoteDraft,
    savingNote,
    loadSavedHelpers,
    openNoteEditor,
    cancelNoteEditor,
    saveNote,
    handleRemove,
    filtered,
    activeSortLabel,
  } = useSavedHelpers({ user });
  // Search collapses behind a tap-to-expand icon (item 26) — matches the
  // pattern ConversationList (Messages) uses: an icon-only trigger by
  // default, replaced inline by the input once tapped, with a Cancel that
  // closes it and clears the query.
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    // Canonical Profile tab body: `space-y-4` under a ProfileTabHeader, with
    // NO scroll container of its own. This tab used to be
    // `h-full flex flex-col overflow-hidden` wrapping its own
    // `overflow-y-auto` pane — a second scroller nested inside the tab
    // container in Profile.tsx, which already scrolls. That gave the screen
    // its own scrollbar, a search row pinned while the list moved under it,
    // and a 12px rhythm where every sibling tab uses 16px: the concrete
    // reason this screen read as built by someone else.
    <div className="space-y-4">
      <ProfileTabHeader
        title="Saved Helprs"
        onBack={onBack}
      />

      <div className="space-y-3">
        {helpers.length > 0 && (
          <div className="flex items-center gap-2">
            {searchOpen ? (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  autoFocus
                  type="search"
                  aria-label="Search saved Helprs"
                  placeholder="Search Helprs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-9 rounded-ds-md"
                />
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearch(""); }}
                  aria-label="Close search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--olivewood)/0.10)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search saved Helprs"
                  className="shrink-0 min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-ds-md transition-colors active:scale-[0.96]"
                  style={{
                    background: "hsl(var(--ivory-sand) / 0.65)",
                    border: "1px solid hsl(var(--olivewood) / 0.18)",
                    color: "hsl(var(--olivewood))",
                  }}
                >
                  <Search className="w-4 h-4" />
                </button>
                <div className="flex-1" />
                {/* Filter — narrows the list to a skill category, next to
                    the sort control (item 26). Highlighted when active so
                    a filtered view doesn't read as a shrinking list with
                    no explanation. */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={categoryFilter ? `Filter: ${JOB_CATEGORY_LABELS[categoryFilter]}` : "Filter by skill"}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-10 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                      style={{
                        background: categoryFilter ? "hsl(var(--bark) / 0.14)" : "hsl(var(--ivory-sand) / 0.65)",
                        border: `1px solid ${categoryFilter ? "hsl(var(--bark) / 0.4)" : "hsl(var(--olivewood) / 0.18)"}`,
                        color: categoryFilter ? "hsl(var(--bark))" : "hsl(var(--olivewood))",
                      }}
                    >
                      <ListFilter className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[80px] sm:max-w-none">
                        {categoryFilter ? JOB_CATEGORY_LABELS[categoryFilter] : "Filter"}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(92vw,240px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                    align="end"
                  >
                    <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest px-2 pt-1 pb-1.5">
                      Filter by skill
                    </p>
                    <button
                      type="button"
                      onClick={() => setCategoryFilter(null)}
                      className={`w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                        categoryFilter === null ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      All Helprs
                    </button>
                    {CATEGORY_FILTER_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setCategoryFilter(value)}
                        className={`w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                          categoryFilter === value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary/70"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Sort: ${activeSortLabel}`}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-10 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                      style={{
                        background: "hsl(var(--ivory-sand) / 0.65)",
                        border: "1px solid hsl(var(--olivewood) / 0.18)",
                        color: "hsl(var(--olivewood))",
                      }}
                    >
                      <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
                      {/* Truncate long label on SE (320 px) instead of hiding
                          it — the icon alone has no visible affordance for
                          sighted users unfamiliar with the sort state. The cap
                          clears the widest option ("Recently saved", 86px at
                          11px/600) so nothing clips at 375; only 320 truncates. */}
                      <span className="truncate max-w-[90px] sm:max-w-none">{activeSortLabel}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(92vw,220px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                    align="end"
                  >
                    <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest px-2 pt-1 pb-1.5">
                      Sort by
                    </p>
                    {sortOptions.map((opt) => {
                      const active = opt.value === sortBy;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSortBy(opt.value)}
                          className={`w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                            active ? "btn-grad-primary text-[hsl(var(--parchment))]" : "text-foreground hover:bg-secondary/70"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl liquid-glass p-4 flex items-center gap-3 motion-safe:animate-pulse"
              >
                <div className="w-12 h-12 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-muted rounded" />
                  <div className="h-3 w-48 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          // A failed RPC fetch shows a recoverable retry surface instead
          // of the misleading "no saved helprs yet" empty state.
          <ErrorState
            variant="inline"
            eyebrow={wasOffline ? "You're offline" : "Hiccup on our end"}
            title={
              wasOffline
                ? "We can't reach the network."
                : "We couldn't load your saved Helprs."
            }
            body={
              wasOffline
                ? "Check your connection and try again — your saved Helprs are safe."
                : "Tap Try again. Your saved Helprs are safe — this is just a loading hiccup on our end."
            }
            onRetry={loadSavedHelpers}
            retryDisabled={loading}
            secondaryAction={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/post-job")}
                className="text-ds-13"
              >
                Post a Job Instead
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={Heart}
            illustration={
              helpers.length === 0 ? (
                <EmptyStateIllustration variant="saved" />
              ) : undefined
            }
            title={helpers.length === 0 ? "No saved Helprs yet." : "Nothing matches that search."}
            body={
              helpers.length === 0
                ? "After your next job, tap the heart on the Helpr's profile — they'll land here for one-tap rebooking."
                : "Try a different search term — your saved list is intact."
            }
            action={
              helpers.length === 0 ? (
                <BarkPillButton onClick={() => navigate("/post-job")}>
                  Post a job
                </BarkPillButton>
              ) : (
                <BarkPillButton onClick={() => setSearch("")}>
                  Clear search
                </BarkPillButton>
              )
            }
          />
        ) : (
          <div className="space-y-3 pb-2">
            {/* Says what the list below is, and — when a search is narrowing
                it — that the rest of the list still exists. Without this a
                filtered view is indistinguishable from a shrinking list. */}
            <p className="font-serif italic text-ds-12 px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {filtered.length === helpers.length
                ? `${helpers.length} saved ${helpers.length === 1 ? "Helpr" : "Helprs"}`
                : `${filtered.length} of ${helpers.length} saved ${helpers.length === 1 ? "Helpr" : "Helprs"}`}
            </p>
            {filtered.map((h) => (
              <SavedHelperCard
                key={h.helper_id}
                h={h}
                editingNoteFor={editingNoteFor}
                noteDraft={noteDraft}
                setNoteDraft={setNoteDraft}
                savingNote={savingNote}
                openNoteEditor={openNoteEditor}
                cancelNoteEditor={cancelNoteEditor}
                saveNote={saveNote}
                handleRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SavedHelpersTab;
