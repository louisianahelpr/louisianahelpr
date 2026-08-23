import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHero, DialogTrigger,
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
  notify_enabled: boolean;
  created_at: string;
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
    locationFilter: string;
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
          .order("created_at", { ascending: false }),
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
      toast.error("Name your search to save it");
      return;
    }
    if (
      !currentFilters.selectedCategory &&
      !currentFilters.minBudget &&
      !currentFilters.maxBudget &&
      !currentFilters.locationFilter
    ) {
      hapticError();
      toast.error("Set at least one filter so the search has something to match on.");
      return;
    }
    hapticMedium();
    setSaving(true);
    const { error } = await supabase.from("saved_searches").insert({
      user_id: userId,
      name: trimmed,
      category: currentFilters.selectedCategory,
      min_budget: currentFilters.minBudget ? Number(currentFilters.minBudget) : null,
      max_budget: currentFilters.maxBudget ? Number(currentFilters.maxBudget) : null,
      location_keyword: currentFilters.locationFilter || null,
      notify_enabled: true,
    });
    setSaving(false);
    if (error) {
      report(error, { tags: { source: "SavedSearches.handleSave" } });
      hapticError();
      toast.error("We couldn't save your search — please try again.");
      return;
    }
    hapticSuccess();
    toast.success("Search saved — we'll ping you when a matching job posts.");
    setName("");
    load();
  };

  const toggleNotify = async (s: SavedSearch) => {
    // Disable a fast double-tap so a second write can't race ahead of
    // the first — the row marker drives the button's disabled state.
    if (togglingId === s.id) return;
    setTogglingId(s.id);
    hapticLight();
    const { error } = await supabase
      .from("saved_searches")
      .update({ notify_enabled: !s.notify_enabled })
      .eq("id", s.id);
    setTogglingId(null);
    if (error) {
      report(error, { tags: { source: "SavedSearches.toggleNotify" } });
      hapticError();
      toast.error("We couldn't update that alert — please try again.");
      return;
    }
    setSearches((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, notify_enabled: !x.notify_enabled } : x))
    );
  };

  const remove = async (id: string) => {
    if (removingId === id) return;
    setRemovingId(id);
    hapticMedium();
    const { error } = await supabase.from("saved_searches").delete().eq("id", id);
    setRemovingId(null);
    if (error) {
      report(error, { tags: { source: "SavedSearches.remove" } });
      hapticError();
      toast.error("We couldn't delete that search — please try again.");
      return;
    }
    setSearches((prev) => prev.filter((x) => x.id !== id));
    hapticSuccess();
    toast.success("Search deleted");
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
        className="max-w-md gap-4"
        // Prevent Radix from auto-focusing the input, which pops the
        // iOS keyboard the moment the dialog opens. The user can tap
        // the field to focus when ready.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={
            <>
              <Bookmark className="w-3 h-3" strokeWidth={2} aria-hidden="true" /> Get notified
            </>
          }
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
              currentFilters.selectedCategory && `Category: ${currentFilters.selectedCategory}`,
              currentFilters.maxBudget && `Max $${currentFilters.maxBudget}`,
              currentFilters.locationFilter && `Location: ${currentFilters.locationFilter}`,
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
                Try again
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
                    toast.success(`Applied "${s.name}"`);
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
                      s.category && `Category: ${categoryLabels[s.category] ?? s.category}`,
                      // Describes the real range. Was `Max $X`, which printed
                      // nothing at all for a min-only search ("$300+") and
                      // understated a banded one.
                      (s.min_budget || s.max_budget) &&
                        (s.min_budget && s.max_budget
                          ? `$${s.min_budget} – $${s.max_budget}`
                          : s.min_budget
                            ? `$${s.min_budget}+`
                            : `Up to $${s.max_budget}`),
                      s.location_keyword && `Loc: ${s.location_keyword}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Any job"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleNotify(s)}
                  disabled={togglingId === s.id}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-ds-sm hover:bg-muted shrink-0 active:scale-[0.95] transition disabled:opacity-50 disabled:cursor-wait"
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
                  className="h-8 w-8 inline-flex items-center justify-center rounded-ds-sm hover:bg-destructive/10 shrink-0 active:scale-[0.95] transition disabled:opacity-50 disabled:cursor-wait"
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

        <DialogFooter className="pt-1">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="h-10 rounded-ds-md"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
