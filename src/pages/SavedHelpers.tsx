import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Heart, Briefcase, Send, Star, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatName } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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

const SavedHelpers = () => {
  usePageTitle("Saved Helprs — Helpr");
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [helpers, setHelpers] = useState<SavedHelper[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_my_saved_helpers");
      if (cancelled) return;
      if (error) {
        toast.error("Couldn't load saved helprs");
        setLoading(false);
        return;
      }
      setHelpers((data as any) || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleRemove = async (helperId: string) => {
    if (!user) return;
    // Optimistic remove with undo: snapshot the row, drop it from UI, then
    // commit the delete after a 5s window unless the user taps Undo.
    const snapshot = helpers.find((h) => h.helper_id === helperId);
    if (!snapshot) return;
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

  const filtered = helpers
    .filter((h) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (h.full_name || "").toLowerCase().includes(q) ||
        (h.skills || "").toLowerCase().includes(q)
      );
    })
    // Sort: most-rebooked helpers first (by completed jobs together),
    // then most-recently-booked. Proven performers surface to the top
    // so power posters can rebook in one tap.
    .sort((a, b) => {
      const aJobs = a.completed_jobs_together ?? 0;
      const bJobs = b.completed_jobs_together ?? 0;
      if (bJobs !== aJobs) return bJobs - aJobs;
      const aLast = a.last_job_at ? new Date(a.last_job_at).getTime() : 0;
      const bLast = b.last_job_at ? new Date(b.last_job_at).getTime() : 0;
      return bLast - aLast;
    });

  return (
    <div className="h-[100dvh] bg-premium-page overflow-hidden flex flex-col">
      <Navbar />
      <main
        className="container mx-auto px-5 pt-3 flex-1 min-h-0 overflow-y-auto no-scrollbar"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
      >
        <div className="max-w-2xl mx-auto space-y-5">

          <div>
            <div className="flex items-center gap-2">
              <BackButton to="/profile" />
              <div className="flex flex-col leading-none">
                <span
                  className="font-serif italic uppercase text-[0.62rem]"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                >
                  Your shortlist
                </span>
                <h1
                  className="font-display italic font-bold leading-tight mt-1"
                  style={{
                    fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.025em",
                  }}
                >
                  Saved helprs
                </h1>
                {helpers.length > 0 && (
                  <span
                    className="font-serif italic mt-0.5 text-[0.78rem]"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    {helpers.length} {helpers.length === 1 ? "helpr" : "helprs"} saved
                  </span>
                )}
              </div>
            </div>
            <p className="font-serif italic text-[0.78rem] mt-1.5 pl-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Send a job offer directly — they get a 24-hour window before your task opens to everyone.
            </p>
          </div>
          {helpers.length > 0 && (
            <div className="relative">
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
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-12">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
                }}
              >
                <Heart className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
              </div>
              <div className="space-y-1.5">
                <span className="text-display-eyebrow">
                  {helpers.length === 0 ? "Nothing saved" : "No matches"}
                </span>
                <p
                  className="font-display italic font-bold leading-tight"
                  style={{
                    fontSize: "clamp(1.05rem, 1.5vw + 0.4rem, 1.35rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {helpers.length === 0 ? "No saved helprs yet." : "Nothing matches that search."}
                </p>
                <p
                  className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  {helpers.length === 0
                    ? "Tap the heart on any helpr's profile to save them for fast rebooking."
                    : "Try a different search term — your saved list is intact."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
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

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
                        className="flex-1 rounded-ds-md"
                        style={{
                          background: "hsl(var(--bark))",
                          backgroundImage: "none",
                          border: "1px solid hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          fontFamily: "Montserrat, system-ui, sans-serif",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          boxShadow: "0 1px 2px hsl(var(--bark) / 0.16), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
                        }}
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
      </main>
    </div>
  );
};

export default SavedHelpers;
