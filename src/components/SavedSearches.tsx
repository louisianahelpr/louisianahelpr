import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { mutationErrorMessage, unwrapMutation } from "@/lib/mutationResult";
import { parseNearbyFilter } from "@/lib/geo";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Bell, BellOff, Bookmark, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { categoryLabels } from "@/components/activity/activityConstants";

interface SavedSearch {
  id: string;
  name: string;
  category: string | null;
  parish: string | null;
  max_budget: number | null;
  min_budget: number | null;
  location_keyword: string | null;
  /**
   * The words the helper typed into the browse search box. There was no column
   * for this until migration 20260901035245, so "Lawn care under $200" saved
   * the budget, saved the category and dropped the words — re-applying the
   * search silently widened it, and no alert could ever match on it.
   */
  query: string | null;
  /**
   * The "Nearby" radius, as a NUMBER OF MILES. It used to be stored as the
   * machine token `nearby:25` in `location_keyword`, where the alert trigger
   * matched it with `location ILIKE '%nearby:25%'` — a test no street address
   * can ever pass, AND-ed with everything else, so a saved search with a
   * radius matched nothing at all, forever. It is a real geographic test now
   * (see the migration): haversine from the searcher's own profile
   * coordinates, falling back to parish equality when coordinates are absent.
   */
  radius_miles: number | null;
  notify_enabled: boolean;
  created_at: string;
}

/** "$50 – $150" / "$300+" / "Up to $150" — one wording, both places it shows. */
function describeBudget(min: number | null, max: number | null): string | null {
  if (min && max) return `$${min} – $${max}`;
  if (min) return `$${min}+`;
  if (max) return `Up to $${max}`;
  return null;
}

/** "Within 25 mi" — never the `nearby:25` token the filter state carries. */
function describeRadius(miles: number | null): string | null {
  return miles ? `Within ${miles} mi` : null;
}

interface Props {
  /** Current dashboard filters — used to pre-fill "Save current search" */
  currentFilters: {
    selectedCategory: string | null;
    // BOTH bounds. `min_budget` is a real column that used to be written by
    // nobody and read by nobody: handleSave inserted only max_budget, and
    // BrowseTasksToolbar's onApplySearch restored only max_budget. So a search
    // saved with a "$50 – $150" band came back as "up to $150" — silently
    // wider than what was saved, with no indication it had changed.
    minBudget: string;
    maxBudget: string;
    /** `""` or the `nearby:<miles>` token the radius chips emit. */
    locationFilter: string;
    /** The browse search box (`?q=`), matched against title + description. */
    searchQuery: string;
  };
  userId: string;
  /** Called when the user clicks an existing saved search to apply it */
  onApplySearch: (search: SavedSearch) => void;
  /**
   * Controlled open state. Pass it (with `onOpenChange`) to drive the dialog
   * from somewhere else on the screen — the built-in bookmark icon trigger is
   * then NOT rendered, because there is nothing for it to sit in.
   *
   * The browse toolbar does exactly that: "Saved searches" is a labelled row
   * inside the filter sheet now, not a fourth icon in the feed's header, and
   * that row cannot host the trigger itself — tapping it closes the sheet,
   * which would unmount the trigger mid-click and take the dialog with it.
   * So the dialog is mounted by the toolbar and opened by state instead.
   *
   * Omit both to keep the self-contained icon-button behaviour.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SavedSearches({
  currentFilters,
  userId,
  onApplySearch,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  // Distinguishes "fetch failed" from "fetched, but empty" so the
  // dialog surfaces a retry surface instead of the misleading
  // "No saved searches yet." empty state on a real outage.
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Per-row in-flight markers so a double-tap on the bell or trash icon
  // can't fire two writes — the row's button stays disabled mid-flight.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) load();
  }, [open]);

  // Open the dialog when another part of the dashboard asks for it —
  // e.g. the Browse Tasks empty-state "Get notified" CTA, which lives in
  // a sibling component and can't reach this dialog's state directly.
  useEffect(() => {
    const openDialog = () => setOpen(true);
    window.addEventListener("open-saved-searches", openDialog);
    return () => window.removeEventListener("open-saved-searches", openDialog);
  }, [setOpen]);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // unwrap() surfaces a failed fetch as an exception so we can
      // distinguish "fetch failed → show retry" from "fetch returned 0
      // rows → show empty state" instead of conflating both as "empty".
      const data = unwrap(
        await supabase
          .from("saved_searches")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          // PostgREST caps any read at 1000 rows here (measured), applied
          // AFTER the ORDER BY. `enforce_saved_search_limit` already caps a
          // user at 10, so this can never truncate — it is stated explicitly
          // so the bound is the query's, not an invariant two files away.
          .limit(50),
      );
      setSearches((data ?? []) as SavedSearch[]);
    } catch (err) {
      report(err, { tags: { source: "SavedSearches.load" } });
      setLoadError(true);
      hapticError();
      toast.error("We couldn't load your saved searches — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      hapticError();
      toast.error("Name your search to save it.");
      return;
    }
    if (
      !currentFilters.selectedCategory &&
      !currentFilters.minBudget &&
      !currentFilters.maxBudget &&
      !currentFilters.locationFilter &&
      !currentFilters.searchQuery.trim()
    ) {
      hapticError();
      toast.error("Set at least one filter so the search has something to match on.");
      return;
    }
    hapticMedium();
    setSaving(true);
    try {
      unwrapMutation(
        // `query` / `radius_miles` arrive with migration 20260901035245, and
        // migrations deploy on merge — so between this bundle shipping and
        // db-deploy finishing, PostgREST answers 42703. That window is handled
        // explicitly below rather than shown as a generic "try again".
        await supabase
          .from("saved_searches")
          .insert({
            user_id: userId,
            name: trimmed,
            category: currentFilters.selectedCategory,
            min_budget: currentFilters.minBudget ? Number(currentFilters.minBudget) : null,
            max_budget: currentFilters.maxBudget ? Number(currentFilters.maxBudget) : null,
            // The radius is a NUMBER now, not the `nearby:25` token that used
            // to be parked in this text column where nothing could match it.
            radius_miles: parseNearbyFilter(currentFilters.locationFilter),
            // `location_keyword` is a genuine free-text place name. Nothing in
            // the app produces one today (the location control is radius-only),
            // so it stays null rather than being handed a machine token.
            location_keyword: null,
            query: currentFilters.searchQuery.trim() || null,
            notify_enabled: true,
          })
          // Required by unwrapMutation: without it the affected-row count is
          // invisible and a silently-rejected insert reads as a success.
          .select("id"),
        { action: "save this search" },
      );
    } catch (err: any) {
      setSaving(false);
      report(err, { tags: { source: "SavedSearches.handleSave" } });
      hapticError();
      if (err?.code === "42703") {
        // The columns land with the migration, which deploys on merge. During
        // that window say something the user can act on rather than "try
        // again" for a thing that cannot yet work.
        toast.error("Saved searches are being upgraded right now — try again in a few minutes.");
      } else {
        toast.error(mutationErrorMessage(err, "We couldn't save your search — please try again."));
      }
      return;
    }
    setSaving(false);
    hapticSuccess();
    setName("");
    load();
  };

  const toggleNotify = async (s: SavedSearch) => {
    // Disable a fast double-tap so a second write can't race ahead of
    // the first — the row marker drives the button's disabled state.
    if (togglingId === s.id) return;
    setTogglingId(s.id);
    hapticLight();
    try {
      // A null `error` does NOT mean the row changed: an UPDATE filtered out
      // by RLS or aimed at a stale id returns `{ data: [], error: null }`, and
      // the optimistic flip below would then show alerts as muted while the
      // row still notifies. `.select("id")` makes the row count observable.
      unwrapMutation(
        await supabase
          .from("saved_searches")
          .update({ notify_enabled: !s.notify_enabled })
          .eq("id", s.id)
          .eq("user_id", userId)
          .select("id"),
        {
          action: "update this alert",
          rejectedMessage: "That saved search is no longer there — refreshing the list.",
        },
      );
    } catch (err) {
      setTogglingId(null);
      report(err, { tags: { source: "SavedSearches.toggleNotify" } });
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't update that alert — please try again."));
      // Re-read rather than leave the row showing a state the server rejected.
      load();
      return;
    }
    setTogglingId(null);
    setSearches((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, notify_enabled: !x.notify_enabled } : x))
    );
  };

  const remove = async (id: string) => {
    if (removingId === id) return;
    setRemovingId(id);
    hapticMedium();
    try {
      // Same trap as toggleNotify, and it was live here: a DELETE that matches
      // ZERO rows is not an error. Without the guard the row vanished from the
      // list, the success haptic fired, and it came straight back on the next
      // open — the user's alert kept notifying after they deleted it.
      unwrapMutation(
        await supabase
          .from("saved_searches")
          .delete()
          .eq("id", id)
          .eq("user_id", userId)
          .select("id"),
        {
          action: "delete this search",
          rejectedMessage: "That saved search was already gone — refreshing the list.",
        },
      );
    } catch (err) {
      setRemovingId(null);
      report(err, { tags: { source: "SavedSearches.remove" } });
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't delete that search — please try again."));
      load();
      return;
    }
    setRemovingId(null);
    setSearches((prev) => prev.filter((x) => x.id !== id));
    hapticSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Only when this component owns its own open state — a controlled
          caller renders its own affordance (see the `open` prop). */}
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Saved searches"
            className="h-10 w-10 rounded-ds-md btn-press text-muted-foreground hover:text-foreground"
          >
            <Bookmark className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
       
        // Prevent Radix from auto-focusing the input, which pops the
        // iOS keyboard the moment the dialog opens. The user can tap
        // the field to focus when ready.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
          title="Saved Searches"
        />

        <div className="space-y-2.5">
          <Label
            htmlFor="search-name"
            className="font-serif italic uppercase text-ds-10"
            style={{ color: "hsl(var(--olivewood) / 0.8)", letterSpacing: "0.16em" }}
          >
            Save current filters
          </Label>
          <div className="flex gap-2">
            <Input
              id="search-name"
              placeholder="e.g. Lawn care under $200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="rounded-ds-md h-11 border-border/60 bg-background/80 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
            />
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              className="h-11 w-11 p-0 rounded-ds-md shrink-0"
              aria-label="Save filter set"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.25} />}
            </Button>
          </div>
          <p
            className="text-ds-11 font-serif italic"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Active filters:{" "}
            {[
              currentFilters.searchQuery.trim() && `“${currentFilters.searchQuery.trim()}”`,
              currentFilters.selectedCategory &&
                `Category: ${categoryLabels[currentFilters.selectedCategory] ?? currentFilters.selectedCategory}`,
              // The whole band, in the same words the saved rows use below.
              // This printed only the max, so a "$50 – $150" band previewed as
              // "Max $150" — wider than what was about to be saved.
              describeBudget(
                currentFilters.minBudget ? Number(currentFilters.minBudget) : null,
                currentFilters.maxBudget ? Number(currentFilters.maxBudget) : null,
              ),
              // Never print the raw `nearby:25` token at a person. It is a
              // machine value; the human reading of it is a radius.
              describeRadius(parseNearbyFilter(currentFilters.locationFilter)),
            ]
              .filter(Boolean)
              .join(" · ") || "None — set filters first"}
          </p>
        </div>

        <div
          className="space-y-2 pt-3"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          {loading ? (
            // Shape-matched placeholders for the saved-search rows below
            // (title line + meta line + bell control) so the loaded list
            // doesn't jump in over a lone centered spinner.
            <div className="space-y-2" aria-hidden="true">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-2 rounded-ds-md liquid-glass p-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-ds-sm shrink-0" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            // Failed fetch reads as recoverable instead of the misleading
            // "No saved searches yet." empty state.
            <div className="flex flex-col items-center text-center px-6 py-6 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "var(--surface-premium)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                }}
              >
                <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <p
                className="font-sans font-semibold text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                We couldn't load your saved searches.
              </p>
              <p
                className="font-serif italic text-ds-12 leading-snug max-w-[280px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Tap retry — your saved searches are safe, this is just a fetch hiccup.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => load()}
                disabled={loading}
                className="mt-1 gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Try Again
              </Button>
            </div>
          ) : searches.length === 0 ? (
            <div className="flex flex-col items-center text-center px-6 py-6 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "var(--surface-premium)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                }}
              >
                <Bookmark className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <p
                className="font-sans font-semibold text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No saved searches yet.
              </p>
              <p
                className="font-serif italic text-ds-12 leading-snug max-w-[280px]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Set a filter combo above and save it — we'll ping you when fresh jobs match.
              </p>
            </div>
          ) : (
            searches.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-ds-md liquid-glass p-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApplySearch(s);
                    setOpen(false);
                  }}
                  className="flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
                >
                  <p
                    className="font-sans font-semibold text-ds-15 truncate"
                    style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                  >
                    {s.name}
                  </p>
                  <p
                    className="text-ds-11 font-serif italic truncate mt-0.5"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {[
                      s.query && `“${s.query}”`,
                      s.category && `Category: ${categoryLabels[s.category] ?? s.category}`,
                      // Describes the real range. Was `Max $X`, which printed
                      // nothing at all for a min-only search ("$300+") and
                      // understated a banded one.
                      describeBudget(s.min_budget, s.max_budget),
                      describeRadius(s.radius_miles),
                      s.location_keyword && `Loc: ${s.location_keyword}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Any Job"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleNotify(s)}
                  disabled={togglingId === s.id}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-sm hover:bg-muted shrink-0 active:scale-[0.95] transition disabled:opacity-50 disabled:cursor-wait"
                  aria-label={s.notify_enabled ? "Mute notifications" : "Enable notifications"}
                  aria-busy={togglingId === s.id}
                  title={s.notify_enabled ? "Notifications on" : "Notifications off"}
                >
                  {togglingId === s.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  ) : s.notify_enabled ? (
                    <Bell className="w-4 h-4 text-primary" aria-hidden="true" />
                  ) : (
                    <BellOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  disabled={removingId === s.id}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-ds-sm hover:bg-destructive/10 shrink-0 active:scale-[0.95] transition disabled:opacity-50 disabled:cursor-wait"
                  aria-label="Delete saved search"
                  aria-busy={removingId === s.id}
                >
                  {removingId === s.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        {/* No `pt-1`, no `h-10`. The 40px height was the only sub-44px
            control in any dialog footer in the app (HIG minimum), and it made
            this Close visibly shorter than the Cancel one dialog over. */}
        {/* `outline`, not `ghost`, because it is the ONLY control in this
            footer — a bare ghost label alone in a row reads as text floating
            at the bottom of the card rather than a button (owner objected to
            exactly that in the report dialog). Paired secondaries stay ghost;
            a lone one is a real button. */}
        <DialogFooter>
          <DialogSecondaryAction onClick={() => setOpen(false)}>
            Close
          </DialogSecondaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
