import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hapticWarning } from "@/lib/haptics";
import { formatName } from "@/lib/utils";
import { toast } from "sonner";
import type { SavedHelper, SavedSort } from "./types";
import { sortOptions } from "./types";

interface UseSavedHelpersArgs {
  user: { id: string } | null | undefined;
  business: { business_id: string } | null | undefined;
}

export function useSavedHelpers({ user, business }: UseSavedHelpersArgs) {
  const [helpers, setHelpers] = useState<SavedHelper[]>([]);
  // Per-helper toggle state for the "Share with team" pin. Tracks the
  // in-flight write so two rapid taps can't race.
  const [togglingShare, setTogglingShare] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguishes "fetch failed" from "fetched, but empty" — without
  // this flag a failed RPC silently falls through to the EmptyState and
  // the user gets a misleading "no saved helprs yet" instead of a
  // recoverable retry affordance.
  const [loadError, setLoadError] = useState(false);
  // Captured at the moment of failure so the error copy can distinguish
  // "you're offline" (actionable by the user) from a server hiccup.
  const [wasOffline, setWasOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SavedSort>("recent");
  // Per-helper note editor — `editingNoteFor` holds the helper_id of
  // the row whose textarea is open; `noteDraft` holds the in-flight
  // text so the user can cancel without losing their place.
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Extracted so the ErrorState's retry button can call back in. The
  // effect below mirrors the same logic but adds a cancellation guard
  // to swallow stale results when the userId changes mid-flight.
  const loadSavedHelpers = async () => {
    if (!user || loading) return;
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc("get_my_saved_helpers");
    if (error) {
      setWasOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      setLoadError(true);
      setLoading(false);
      return;
    }
    const list = (data as SavedHelper[]) || [];
    // Augment with business_account_id from the raw row — the RPC
    // doesn't surface it yet (the column ships in migration
    // 20260609170000). Missing column = empty join, leaving every row
    // with business_account_id = null which is the correct default.
    if (list.length > 0) {
      const { data: shareRows } = await supabase
        .from("favorite_helpers")
        .select("helper_id, business_account_id" as any)
        .eq("customer_id", user.id);
      const byHelper = new Map<string, string | null>(
        ((shareRows ?? []) as any[]).map((r) => [r.helper_id, r.business_account_id ?? null]),
      );
      for (const h of list) h.business_account_id = byHelper.get(h.helper_id) ?? null;
    }
    setHelpers(list);
    setLoading(false);
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
        setWasOffline(typeof navigator !== "undefined" && navigator.onLine === false);
        setLoadError(true);
        setLoading(false);
        return;
      }
      const list = (data as SavedHelper[]) || [];
      if (list.length > 0) {
        const { data: shareRows } = await supabase
          .from("favorite_helpers")
          .select("helper_id, business_account_id" as any)
          .eq("customer_id", user.id);
        if (cancelled) return;
        const byHelper = new Map<string, string | null>(
          ((shareRows ?? []) as any[]).map((r) => [r.helper_id, r.business_account_id ?? null]),
        );
        for (const h of list) h.business_account_id = byHelper.get(h.helper_id) ?? null;
      }
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

  /** Flip whether this saved helper is visible to the rest of the
      business team. Writes `business_account_id` on favorite_helpers
      (migration 20260609170000). PGRST204 → graceful toast when the
      migration hasn't reached prod yet. */
  const toggleTeamShare = async (helperId: string, currentlyShared: boolean) => {
    if (!user || !business) return;
    setTogglingShare(helperId);
    const nextValue = currentlyShared ? null : business.business_id;
    // Optimistic flip first so the UI feels instant.
    setHelpers((prev) =>
      prev.map((h) => (h.helper_id === helperId ? { ...h, business_account_id: nextValue } : h)),
    );
    const { error } = await supabase
      .from("favorite_helpers")
      .update({ business_account_id: nextValue } as any)
      .eq("customer_id", user.id)
      .eq("helper_id", helperId);
    setTogglingShare(null);
    if (error) {
      setHelpers((prev) =>
        prev.map((h) =>
          h.helper_id === helperId ? { ...h, business_account_id: currentlyShared ? business.business_id : null } : h,
        ),
      );
      const code = (error as { code?: string }).code;
      const msg = code === "PGRST204" || code === "42703"
        ? "Team sharing isn't live yet — we're rolling it out shortly."
        : "Couldn't update sharing — please try again.";
      toast.error(msg);
      return;
    }
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
      const { error } = await supabase
        .from("favorite_helpers")
        .delete()
        .eq("customer_id", user.id)
        .eq("helper_id", helperId);
      if (error) {
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
    const matched = helpers.filter((h) => {
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
  }, [helpers, search, sortBy]);

  const activeSortLabel = sortOptions.find((o) => o.value === sortBy)?.label ?? sortOptions[0].label;

  const metaText = helpers.length > 0
    ? `${helpers.length} ${helpers.length === 1 ? "Helpr" : "Helprs"} saved · send a direct offer with a 24-hour first-look window.`
    : "Save Helprs you trust so you can rebook in one tap.";

  return {
    helpers,
    togglingShare,
    loading,
    loadError,
    wasOffline,
    search,
    setSearch,
    sortBy,
    setSortBy,
    editingNoteFor,
    noteDraft,
    setNoteDraft,
    savingNote,
    loadSavedHelpers,
    openNoteEditor,
    cancelNoteEditor,
    saveNote,
    toggleTeamShare,
    handleRemove,
    filtered,
    activeSortLabel,
    metaText,
  };
}
