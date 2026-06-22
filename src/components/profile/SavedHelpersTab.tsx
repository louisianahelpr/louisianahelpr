// Saved Helpers — Profile tab version.
//
// Replaces the standalone /saved-helpers route. Shares the same data
// load + remove flow as the prior SavedHelpers page, but wraps the
// content in the standard Profile shell (ProfileTabHeader + tab
// container) so the back button, top padding, and dock alignment
// stay consistent with every other Profile sub-tab.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { hapticWarning } from "@/lib/haptics";
import { Heart, Briefcase, Send, Star, Search, ArrowUpDown, StickyNote, Check, X, Users } from "lucide-react";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatName } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { PublicReviewWall } from "@/components/profile/PublicReviewWall";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";

type SavedSort = "rebooked" | "recent" | "rating" | "alpha";

const sortOptions: { value: SavedSort; label: string }[] = [
  { value: "recent", label: "Recent activity" },
  { value: "rating", label: "Rating" },
  { value: "rebooked", label: "Jobs together" },
  { value: "alpha", label: "Alphabetical" },
];

interface SavedHelper {
  helper_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  parish: string | null;
  skills: string | null;
  hourly_rate: number | null;
  saved_at: string;
  completed_jobs_together: number;
  last_job_at: string | null;
  /** Average rating from the helper's public review wall. Optional —
      the get_my_saved_helpers RPC may not surface it on older
      deploys; the Rating sort treats missing values as 0. */
  avg_rating?: number | null;
  /** Poster-only note. Surfaced by the get_my_saved_helpers RPC once
      migration 20260609110000 is applied; nullable so older deploys
      return undefined. */
  private_note?: string | null;
  /** When non-null, this saved-helper row is visible to every active
      teammate of the named business. Surfaced once migration
      20260609170000 (business_account_id on favorite_helpers) lands. */
  business_account_id?: string | null;
}

interface SavedHelpersTabProps {
  onBack: () => void;
}

export function SavedHelpersTab({ onBack }: SavedHelpersTabProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { business } = useMyBusiness();
  const [helpers, setHelpers] = useState<SavedHelper[]>([]);
  // Per-helper toggle state for the "Visible to team" pin. Tracks the
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
    toast.success(value ? "Note saved" : "Note removed");
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
    toast.success(nextValue ? "Now visible to your team" : "Hidden from your team");
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
        toast.error("Couldn't remove — restored");
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
    ? `${helpers.length} ${helpers.length === 1 ? "helpr" : "helprs"} saved · send a direct offer with a 24-hour first-look window.`
    : "Save helprs you trust so you can rebook in one tap.";

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">
      <ProfileTabHeader
        eyebrow="Your shortlist"
        title="Saved helprs"
        meta={metaText}
        onBack={onBack}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-3">
        {helpers.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search saved helpers"
                placeholder="Search by name or skills…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-ds-md"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Sort: ${activeSortLabel}`}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-10 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                  style={{
                    background: "hsla(0, 0%, 100%, 0.65)",
                    border: "1px solid hsl(var(--olivewood) / 0.18)",
                    color: "hsl(var(--olivewood))",
                  }}
                >
                  <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
                  {/* Truncate long label on SE (320 px) instead of hiding
                      it — the icon alone has no visible affordance for
                      sighted users unfamiliar with the sort state. */}
                  <span className="truncate max-w-[80px] sm:max-w-none">{activeSortLabel}</span>
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
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl liquid-glass p-4 flex items-center gap-3 animate-pulse"
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
            eyebrow={wasOffline ? "You're offline" : "Something went wrong"}
            title={
              wasOffline
                ? "We can't reach the network."
                : "We couldn't load your saved helprs."
            }
            body={
              wasOffline
                ? "Check your connection and try again — your saved helprs are safe."
                : "Tap Try again. Your saved helprs are safe — this is just a loading hiccup on our end."
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
                Post a job instead
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
            eyebrow={helpers.length === 0 ? "Nothing saved" : "No matches"}
            title={helpers.length === 0 ? "No saved helprs yet." : "Nothing matches that search."}
            body={
              helpers.length === 0
                ? "After your next job, tap the heart on the helpr's profile — they'll land here for one-tap rebooking."
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
            {filtered.map((h) => {
              const initials = (h.full_name || "?")
                .split(" ")
                .map((w) => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);
              return (
                <div
                  key={h.helper_id}
                  className="rounded-2xl liquid-glass p-4 space-y-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <Link
                      to={`/user/${h.helper_id}`}
                      className="shrink-0"
                      aria-label={`View ${formatName(h.full_name)}'s profile`}
                    >
                      {h.avatar_url ? (
                        <img loading="lazy" decoding="async"
                          src={h.avatar_url}
                          alt=""
                          className="w-12 h-12 rounded-full object-cover border border-[hsl(var(--border)/0.6)]"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display italic font-bold">
                          {initials}
                        </div>
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/user/${h.helper_id}`}
                        className="font-display italic font-bold leading-tight hover:text-primary transition-colors block truncate"
                        style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
                      >
                        {formatName(h.full_name)}
                      </Link>
                      <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 font-serif italic flex-wrap" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                        {h.completed_jobs_together > 0 && (
                          <span className="flex items-center gap-1 text-primary">
                            <Star className="w-3 h-3 fill-primary" />
                            {h.completed_jobs_together} job{h.completed_jobs_together === 1 ? "" : "s"} together
                          </span>
                        )}
                        {h.completed_jobs_together > 0 && h.last_job_at && (
                          <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                        )}
                        {h.last_job_at && (
                          <span>
                            Last {formatDistanceToNow(new Date(h.last_job_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      {h.skills && (
                        <p className="font-serif italic mt-1.5 line-clamp-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                          {h.skills}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Condensed review wall (#86) — 0-2 recent quotes so
                      the trust signal lives on the rebook surface, not
                      just the deep-link profile. Renders nothing when
                      the helpr has no visible reviews. */}
                  <PublicReviewWall
                    helperId={h.helper_id}
                    variant="condensed"
                    onSeeAll={() => navigate(`/user/${h.helper_id}?tab=reviews`)}
                  />

                  {/* Private note — poster-only memo about this helpr.
                      Closed by default, tap to expand into a small
                      textarea. Never shown to the helpr (RLS scopes
                      reads/writes to customer_id). */}
                  {editingNoteFor === h.helper_id ? (
                    <div
                      className="rounded-ds-md p-2.5 space-y-2"
                      style={{
                        background: "hsl(var(--gold-warm) / 0.06)",
                        border: "1px solid hsl(var(--gold-warm) / 0.22)",
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <StickyNote className="w-3 h-3" style={{ color: "hsl(var(--bark))" }} />
                        <span className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--bark) / 0.8)", letterSpacing: "0.14em" }}>
                          Private note · only you see this
                        </span>
                      </div>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="e.g. great with painting, prefers Tuesdays"
                        rows={2}
                        maxLength={500}
                        aria-label="Private note about this helpr"
                        className="w-full rounded-ds-sm border border-border/40 bg-card px-2 py-1.5 text-ds-13 font-serif italic resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelNoteEditor}
                          disabled={savingNote}
                          className="inline-flex items-center gap-1 rounded-ds-sm px-2.5 py-1 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-transform"
                          style={{ color: "hsl(var(--olivewood))" }}
                        >
                          <X className="w-3.5 h-3.5" /> Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveNote(h.helper_id)}
                          disabled={savingNote}
                          className="inline-flex items-center gap-1 rounded-ds-sm px-2.5 py-1 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-transform disabled:opacity-60"
                          style={{
                            background: "hsl(var(--bark))",
                            color: "hsl(var(--parchment))",
                          }}
                        >
                          <Check className="w-3.5 h-3.5" /> {savingNote ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : h.private_note?.trim() ? (
                    <button
                      type="button"
                      onClick={() => openNoteEditor(h.helper_id, h.private_note)}
                      aria-label="Edit private note"
                      className="w-full text-left rounded-ds-md p-2.5 flex gap-2 active:opacity-80 transition-opacity"
                      style={{
                        background: "hsl(var(--gold-warm) / 0.06)",
                        border: "1px solid hsl(var(--gold-warm) / 0.22)",
                      }}
                    >
                      <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} />
                      <p className="font-serif italic text-ds-13 leading-snug flex-1 min-w-0" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
                        {h.private_note}
                      </p>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openNoteEditor(h.helper_id, null)}
                      className="inline-flex items-center gap-1 text-ds-11 font-semibold active:opacity-70 self-start"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      <StickyNote className="w-3 h-3" /> Add a private note
                    </button>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="bark"
                      size="sm"
                      onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
                      className="flex-1 rounded-ds-md"
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Offer a job
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/user/${h.helper_id}`)}
                      className="rounded-ds-md"
                    >
                      <Briefcase className="w-3.5 h-3.5 mr-1.5" />
                      Profile
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(h.helper_id)}
                      className="rounded-ds-md"
                      aria-label="Remove from saved"
                    >
                      <Heart className="w-3.5 h-3.5" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
                    </Button>
                  </div>

                  {business && (
                    <button
                      type="button"
                      onClick={() => toggleTeamShare(h.helper_id, !!h.business_account_id)}
                      disabled={togglingShare === h.helper_id}
                      className="inline-flex items-center gap-1.5 text-ds-11 font-semibold active:opacity-70 self-start"
                      style={{
                        color: h.business_account_id
                          ? "hsl(var(--olivewood))"
                          : "hsl(var(--bark))",
                      }}
                      aria-pressed={!!h.business_account_id}
                    >
                      <Users className="w-3 h-3" />
                      {h.business_account_id ? "Visible to team" : "Share with team"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SavedHelpersTab;
