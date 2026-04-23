import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Heart, MapPin, Briefcase, Send, Star, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/PageHeader";
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
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    setRemovingId(helperId);
    const { error } = await supabase
      .from("favorite_helpers")
      .delete()
      .eq("customer_id", user.id)
      .eq("helper_id", helperId);
    if (error) {
      toast.error("Couldn't remove");
    } else {
      setHelpers((prev) => prev.filter((h) => h.helper_id !== helperId));
      toast.success("Removed from saved");
    }
    setRemovingId(null);
  };

  const filtered = helpers.filter((h) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (h.full_name || "").toLowerCase().includes(q) ||
      (h.parish || "").toLowerCase().includes(q) ||
      (h.skills || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <PageHeader title="Saved Helprs" onBack={() => navigate(-1)} />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-4">
          <p className="text-sm text-muted-foreground">
            Your favorite helprs. Send a job offer directly — they get a 24-hour
            window before your task opens to everyone.
          </p>

          {helpers.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, parish or skills…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 animate-pulse"
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
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center space-y-3">
              <Heart className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {helpers.length === 0
                    ? "No saved helprs yet"
                    : "No matches"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {helpers.length === 0
                    ? "Tap the heart on any helpr's profile to save them here for fast rebooking."
                    : "Try a different search term."}
                </p>
              </div>
              {helpers.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/heroes")}
                  className="rounded-xl"
                >
                  Browse top helprs
                </Button>
              )}
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
                    className="rounded-2xl border border-border bg-card p-4 space-y-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <Link
                        to={`/user/${h.helper_id}`}
                        className="shrink-0"
                        aria-label="View profile"
                      >
                        {h.avatar_url ? (
                          <img
                            src={h.avatar_url}
                            alt=""
                            className="w-12 h-12 rounded-full object-cover border border-border"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                            {initials}
                          </div>
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/user/${h.helper_id}`}
                          className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                        >
                          {formatName(h.full_name)}
                        </Link>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                          {h.parish && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {h.parish}
                            </span>
                          )}
                          {h.completed_jobs_together > 0 && (
                            <span className="flex items-center gap-1 text-primary">
                              <Star className="w-3 h-3 fill-primary" />
                              {h.completed_jobs_together} job
                              {h.completed_jobs_together === 1 ? "" : "s"} together
                            </span>
                          )}
                          {h.last_job_at && (
                            <span>
                              Last:{" "}
                              {formatDistanceToNow(new Date(h.last_job_at), {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                        </div>
                        {h.skills && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-1">
                            {h.skills}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate(`/post-job?offerTo=${h.helper_id}`)
                        }
                        className="flex-1 rounded-xl"
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Offer a Job
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/user/${h.helper_id}`)}
                        className="rounded-xl"
                      >
                        <Briefcase className="w-3.5 h-3.5 mr-1.5" />
                        Profile
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(h.helper_id)}
                        disabled={removingId === h.helper_id}
                        className="rounded-xl"
                        aria-label="Remove from saved"
                      >
                        {removingId === h.helper_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Heart className="w-3.5 h-3.5 fill-destructive text-destructive" />
                        )}
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
