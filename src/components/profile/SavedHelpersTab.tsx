// Saved Helpers — Profile tab version.
//
// Replaces the standalone /saved-helpers route. Shares the same data
// load + remove flow as the prior SavedHelpers page, but wraps the
// content in the standard Profile shell (ProfileTabHeader + tab
// container) so the back button, top padding, and dock alignment
// stay consistent with every other Profile sub-tab.

import { useNavigate } from "react-router-dom";
import { Heart, Search, ArrowUpDown, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    retrying,
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

  // The count that used to sit on a line of its own beneath the controls.
  // It is the READOUT of the two menus beside it — it changes when you
  // filter — so it belongs on their row, not on a fourth one.
  const countLabel =
    filtered.length === helpers.length
      ? `${helpers.length} saved`
      : `${filtered.length} of ${helpers.length} saved`;

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
          <div className="space-y-2">
            {/* ONE coherent control group, two rows instead of four lines.

                Before: an icon-only square search BUTTON, then a Filter pill,
                then a Recent-activity pill — three peers wearing two shapes,
                one of which was a text field disguised as a menu-sized
                button — and then the result count alone on a fourth line.

                After: search is a real inline FIELD spanning row 1 (the same
                shape BrowseSearchBar and the browse filter panel already use,
                so this screen stops being the one place search is a button),
                and the two menus sit on row 2 with the count right-aligned
                beside them as their readout. Measured: all three share row 2
                at 320 / 375 / 768 / 1440 (the count's top matches the pills'
                at every one). `flex-wrap` is the safety valve for the cases
                that are wider than any of those — senior mode's larger type,
                or a long selected filter next to "12 of 40 saved" — so the
                count drops to a second line instead of pushing a pill off
                the edge. The count reads "3 saved" rather than "3 saved
                Helprs": the noun is already the page title two rows up, and
                the shorter string is what lets it share this row at 320. */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              {/* Deliberately NOT autoFocus: the field is permanent now, so
                  focusing it on tab-open would throw the iOS keyboard over
                  the list the user came to read. Same call BrowseSearchBar
                  makes for the same reason. `pr-10` only when there is text
                  to clear, so an empty field carries no dead right lane. */}
              <input
                type="search"
                aria-label="Search saved Helprs"
                placeholder="Search saved Helprs…"
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full pl-9 ${search.length > 0 ? "pr-10" : "pr-3"} h-11 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground`}
              />
              {search.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  // `!min-h-0 !min-w-0` — index.css's bare
                  // `button { min-height: 44px; min-width: 44px }` tap-target
                  // rule otherwise wins over `h-7 w-7` and spills a 44px box
                  // past the field's edges. The field itself is the 44px
                  // target; this is a glyph inside it.
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
                >
                  <X className="w-4 h-4" strokeWidth={2.25} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Filter — narrows the list to a skill category, next to
                  the sort control (item 26). Highlighted when active so
                  a filtered view doesn't read as a shrinking list with
                  no explanation. An ACTIVE filter is a selected control, so
                  it wears the app's one selected treatment — glossy
                  `btn-grad-primary` — not a flat tint. */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={categoryFilter ? `Filter: ${JOB_CATEGORY_LABELS[categoryFilter]}` : "Filter by skill"}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-11 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all ${
                      categoryFilter ? "btn-grad-primary text-[hsl(var(--parchment))]" : ""
                    }`}
                    style={
                      categoryFilter
                        ? undefined
                        : {
                            background: "hsl(var(--ivory-sand) / 0.65)",
                            border: "1px solid hsl(var(--olivewood) / 0.18)",
                            color: "hsl(var(--olivewood))",
                          }
                    }
                  >
                    <ListFilter className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[80px] sm:max-w-none">
                      {categoryFilter ? JOB_CATEGORY_LABELS[categoryFilter] : "Filter"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[min(92vw,240px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                  align="start"
                >
                  <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest px-2 pt-1 pb-1.5">
                    Filter by skill
                  </p>
                  {/* Selected row is glossy, exactly like the Sort menu's.
                      It used to be a flat `bg-primary` while its sibling
                      popover a few lines below used `btn-grad-primary` —
                      two menus on one row, selecting in two different
                      visual languages. */}
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(null)}
                    className={`w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                      categoryFilter === null ? "btn-grad-primary text-[hsl(var(--parchment))]" : "text-foreground hover:bg-secondary/70"
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
                        categoryFilter === value ? "btn-grad-primary text-[hsl(var(--parchment))]" : "text-foreground hover:bg-secondary/70"
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
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-11 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
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
                  align="start"
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
              {/* The list's own readout, on the row with the controls that
                  change it. `aria-live` so a filter or a query announces the
                  new result count instead of the list silently shrinking. */}
              <p
                aria-live="polite"
                className="ml-auto shrink-0 font-serif italic text-ds-12"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {countLabel}
              </p>
            </div>
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
            // `retrying`, NOT `loading`. This branch only renders when
            // `loading` is false (it is the preceding arm of the same
            // ternary), so `retryDisabled={loading}` was dead — the button
            // never disabled, and a second tap hit a guard that dropped it
            // silently. `retrying` is the retry's own in-flight flag, so the
            // press is visibly acknowledged and the card stays put instead of
            // flashing back to the skeleton.
            retryDisabled={retrying}
            retryLabel={retrying ? "Trying again…" : "Try again"}
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
                  {/* "Post a Job", title case — the same label the desktop
                      rail, the dashboard CTA and this screen's own error
                      state ("Post a Job Instead") use. The lowercase "job"
                      here was the only place the app called it something
                      else. */}
                  Post a Job
                </BarkPillButton>
              ) : (
                <BarkPillButton onClick={() => setSearch("")}>
                  Clear search
                </BarkPillButton>
              )
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start pb-2">
            {/* The count that used to head this list moved onto the controls
                row above — see `countLabel`. It said the same thing one line
                lower, and a single short phrase does not earn a line of its
                own between the controls and the first card.

                A GRID, not a stack. Saved Helprs are sibling cards, and the
                standard's rule for repeating items is a responsive grid on
                wide web — stacked, each card ran the full 1072px of the
                desktop column and the "Offer a Job" CTA inside it stretched
                to 980px, a primary button wider than most laptops' content
                area. `items-start` is load-bearing: without it the grid
                stretches every card in a row to the tallest one, which would
                hand a sparse card the height of the rich card beside it and
                undo the whole point of making cards hug their content. */}
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
