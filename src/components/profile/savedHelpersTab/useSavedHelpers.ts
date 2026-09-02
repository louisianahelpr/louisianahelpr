import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticWarning } from "@/lib/haptics";
import { formatName } from "@/lib/utils";
import { toast } from "sonner";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import type { SavedHelper, SavedSort } from "./types";
import { sortOptions } from "./types";

interface UseSavedHelpersArgs {
  user: { id: string } | null | undefined;
}

export function useSavedHelpers({ user }: UseSavedHelpersArgs) {
  const [helpers, setHelpers] = useState<SavedHelper[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguishes "fetch failed" from "fetched, but empty" — without
  // this flag a failed RPC silently falls through to the EmptyState and
  // the user gets a misleading "no saved helprs yet" instead of a
  // recoverable retry affordance.
  const [loadError, setLoadError] = useState(false);
  // In-flight flag for the ErrorState's "Try again" button ONLY — deliberately
  // NOT `loading`. See `loadSavedHelpers` below for why the two are separate.
  const [retrying, setRetrying] = useState(false);
  // Captured at the moment of failure so the error copy can distinguish
  // "you're offline" (actionable by the user) from a server hiccup.
  const [wasOffline, setWasOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SavedSort>("recent");
  // Skill-category filter (item 26) — narrows the list to helprs whose
  // `skills` string mentions the selected category. `null` = no filter.
  const [categoryFilter, setCategoryFilter] = useState<JobCategory | null>(null);
  // Per-helper note editor — `editingNoteFor` holds the helper_id of
  // the row whose textarea is open; `noteDraft` holds the in-flight
  // text so the user can cancel without losing their place.
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Extracted so the ErrorState's retry button can call back in. The
  // effect below mirrors the same logic but adds a cancellation guard
  // to swallow stale results when the userId changes mid-flight.
  //
  // THE GUARD USED TO BE `if (!user || loading) return`, and both halves of
  // that were wrong.
  //
  // `loading` is the FIRST branch of the tab's render chain
  // (`loading ? <skeleton> : loadError ? <ErrorState> : …`), so it is false by
  // construction whenever the "Try again" button is on screen. The half of the
  // guard meant to stop a double-tap therefore could never fire — and in the
  // one shape where it could (a caller invoking this while `loading` is stuck
  // true, e.g. the effect's `if (!user) return` early-exit that never clears
  // it) it would have swallowed the tap in silence: no disabled state, no
  // relabel, no request. A retry control that ignores a press without saying
  // so is worse than no control, because the user cannot tell a dead button
  // from a slow network.
  //
  // So the retry's in-flight flag is its own state, and it deliberately does
  // NOT set `loading`. Flipping `loading` would unmount the ErrorState
  // mid-press and flash the skeleton, cutting the thread between the press and
  // its result. `retrying` keeps the error card mounted with its button
  // disabled and relabelled, and `loadError` is only cleared once a new result
  // actually lands — so a second failure re-enables the button in place
  // instead of flickering error → skeleton → error.
  const loadSavedHelpers = async () => {
    if (!user || retrying) return;
    setRetrying(true);
    const { data, error } = await supabase.rpc("get_my_saved_helpers");
    if (error) {
      report(error, { severity: "warning", tags: { source: "useSavedHelpers.retry" } });
      setWasOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      setLoadError(true);
      setRetrying(false);
      return;
    }
    const list = (data as SavedHelper[]) || [];
    setHelpers(list);
    setLoadError(false);
    setRetrying(false);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      const { data, error } = await supabase.rpc("get_my_saved_helpers");
      if (cancelled) return;
      if (error) {
        report(error, { severity: "warning", tags: { source: "useSavedHelpers.load" } });
        setWasOffline(typeof navigator !== "undefined" && navigator.onLine === false);
        setLoadError(true);
        setLoading(false);
        return;
      }
      const list = (data as SavedHelper[]) || [];
      setHelpers(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const openNoteEditor = (helperId: string, current: string | null | undefined) => {
    setEditingNoteFor(helperId);
    setNoteDraft(current ?? "");
  };

  const cancelNoteEditor = () => {
    setEditingNoteFor(null);
    setNoteDraft("");
  };

  const saveNote = async (helperId: string) => {
    if (!user) return;
    const trimmed = noteDraft.trim();
    const value = trimmed.length === 0 ? null : trimmed;
    setSavingNote(true);
    // Optimistic update so the closed editor renders the new note
    // immediately — a failed write rolls the row back.
    const snapshot = helpers.find((h) => h.helper_id === helperId);
    setHelpers((prev) => prev.map((h) => h.helper_id === helperId ? { ...h, private_note: value } : h));
    // `private_note` isn't in the generated supabase types yet (added
    // in migration 20260609110000); cast through any to side-step
    // until types regenerate.
    const { error } = await supabase
      .from("favorite_helpers")
      .update({ private_note: value } as any)
      .eq("customer_id", user.id)
      .eq("helper_id", helperId);
    setSavingNote(false);
    if (error) {
      if (snapshot) {
        setHelpers((prev) => prev.map((h) => h.helper_id === helperId ? snapshot : h));
      }
      // PGRST204 = column not found (migration hasn't run on prod yet).
      // Tell the user gracefully rather than the raw error.
      const msg = (error as { code?: string }).code === "PGRST204"
        ? "Notes aren't available yet on this build — we're rolling them out shortly."
        : "Couldn't save your note — please try again.";
      toast.error(msg);
      return;
    }
    setEditingNoteFor(null);
    setNoteDraft("");
  };

  const handleRemove = async (helperId: string) => {
    if (!user) return;
    const snapshot = helpers.find((h) => h.helper_id === helperId);
    if (!snapshot) return;
    // Warning haptic on destructive action — matches the pattern used in
    // BrandConfirmDialog's destructive "bark" tone.
    void hapticWarning();
    setHelpers((prev) => prev.filter((h) => h.helper_id !== helperId));

    let undone = false;
    const timer = setTimeout(async () => {
      if (undone) return;
      // `.select("id")` because a DELETE matching zero rows is
      // `{ data: [], error: null }`. The card is already gone from the list
      // (optimistic, with a 5s Undo), so without a row count an RLS refusal
      // silently kept the helper saved and they reappeared on the next visit
      // — after the toast said "Removed from saved".
      const { data, error } = await supabase
        .from("favorite_helpers")
        .delete()
        .eq("customer_id", user.id)
        .eq("helper_id", helperId)
        .select("id");
      if (error || !data || data.length === 0) {
        if (error) report(error, { tags: { source: "useSavedHelpers.remove" } });
        toast.error("Couldn't remove — restored.");
        setHelpers((prev) =>
          prev.some((h) => h.helper_id === helperId) ? prev : [snapshot, ...prev],
        );
      }
    }, 5000);

    toast("Removed from saved", {
      description: `${formatName(snapshot.full_name)} won't appear here anymore.`,
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          clearTimeout(timer);
          setHelpers((prev) =>
            prev.some((h) => h.helper_id === helperId) ? prev : [snapshot, ...prev],
          );
        },
      },
    });
  };

  const filtered = useMemo(() => {
    const categoryLabel = categoryFilter ? JOB_CATEGORY_LABELS[categoryFilter].toLowerCase() : null;
    const matched = helpers.filter((h) => {
      if (categoryLabel && !(h.skills || "").toLowerCase().includes(categoryLabel)) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (h.full_name || "").toLowerCase().includes(q) ||
        (h.skills || "").toLowerCase().includes(q)
      );
    });

    if (sortBy === "recent") {
      // Most recent activity first — last_job_at is the latest signal we
      // have. Falls back to saved_at when there's no job history yet.
      return matched.sort((a, b) => {
        const aT = (a.last_job_at ? new Date(a.last_job_at) : new Date(a.saved_at)).getTime();
        const bT = (b.last_job_at ? new Date(b.last_job_at) : new Date(b.saved_at)).getTime();
        return bT - aT;
      });
    }
    if (sortBy === "rating") {
      // Highest average rating first — missing values fall to 0 so
      // an unrated helper doesn't outrank a 4.9-star one. Ties break
      // by jobs-together so a 5.0 with 1 job ranks below a 5.0 with
      // 10 (rebooking signal is a tiebreaker, not a primary).
      return matched.sort((a, b) => {
        const aR = a.avg_rating ?? 0;
        const bR = b.avg_rating ?? 0;
        if (bR !== aR) return bR - aR;
        return (b.completed_jobs_together ?? 0) - (a.completed_jobs_together ?? 0);
      });
    }
    if (sortBy === "alpha") {
      // Alphabetical by full name, case-insensitive, locale-aware.
      // Missing names sink to the bottom so a placeholder doesn't take
      // the top row from a real helpr.
      return matched.sort((a, b) => {
        const aN = (a.full_name ?? "").trim();
        const bN = (b.full_name ?? "").trim();
        if (!aN && bN) return 1;
        if (aN && !bN) return -1;
        return aN.localeCompare(bN, undefined, { sensitivity: "base" });
      });
    }
    // Most jobs together (rebooked) — proven performers surface to the top
    return matched.sort((a, b) => {
      const aJobs = a.completed_jobs_together ?? 0;
      const bJobs = b.completed_jobs_together ?? 0;
      if (bJobs !== aJobs) return bJobs - aJobs;
      const aLast = a.last_job_at ? new Date(a.last_job_at).getTime() : 0;
      const bLast = b.last_job_at ? new Date(b.last_job_at).getTime() : 0;
      return bLast - aLast;
    });
  }, [helpers, search, sortBy, categoryFilter]);

  const activeSortLabel = sortOptions.find((o) => o.value === sortBy)?.label ?? sortOptions[0].label;

  const metaText = helpers.length > 0
    ? `${helpers.length} ${helpers.length === 1 ? "Helpr" : "Helprs"} saved · send a direct offer with a first-look window you choose.`
    : "Save Helprs you trust so you can rebook in one tap.";

  return {
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
    metaText,
  };
}
