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
import { Heart, Briefcase, Send, Star, Search, ArrowUpDown } from "lucide-react";
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

type SavedSort = "rebooked" | "recent";

const sortOptions: { value: SavedSort; label: string }[] = [
  { value: "rebooked", label: "Most rebooked" },
  { value: "recent", label: "Most recent" },
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
}

interface SavedHelpersTabProps {
  onBack: () => void;
}

export function SavedHelpersTab({ onBack }: SavedHelpersTabProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [helpers, setHelpers] = useState<SavedHelper[]>([]);
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
  const [sortBy, setSortBy] = useState<SavedSort>("rebooked");

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
    setHelpers((data as SavedHelper[]) || []);
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
      setHelpers((data as SavedHelper[]) || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
    // Most rebooked first (default) — proven performers surface to the top
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
                          className="w-12 h-12 rounded-full object-cover border border-border"
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
                      <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 font-serif italic flex-wrap" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
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
                        <p className="font-serif italic mt-1.5 line-clamp-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
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
