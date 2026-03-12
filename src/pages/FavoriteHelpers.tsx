import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Heart, MapPin, Star, Briefcase, Clock } from "lucide-react";
import { toast } from "sonner";

import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface FavoriteHelper {
  id: string;
  helper_id: string;
  profile: Profile | null;
  stats: { completedJobs: number; avgRating: number; reviewCount: number };
}

const FavoriteHelpers = () => {
  usePageTitle("Favorite Helpers — Helpr");
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteHelper[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    setCurrentUserId(session.user.id);

    const { data: favs } = await supabase
      .from("favorite_helpers")
      .select("id, helper_id")
      .eq("customer_id", session.user.id);

    if (!favs || favs.length === 0) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    const helperIds = favs.map(f => f.helper_id);
    const [profilesRes, reviewsRes, completedRes] = await Promise.all([
      supabase.from("profiles").select("*").in("user_id", helperIds),
      supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", helperIds),
      supabase.from("jobs").select("helper_id").in("helper_id", helperIds).eq("status", "completed"),
    ]);

    const profileMap = new Map(profilesRes.data?.map(p => [p.user_id, p]) || []);
    const reviewMap = new Map<string, number[]>();
    reviewsRes.data?.forEach(r => {
      if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
      reviewMap.get(r.reviewee_id)!.push(r.rating);
    });
    const completedMap = new Map<string, number>();
    completedRes.data?.forEach(j => {
      if (j.helper_id) completedMap.set(j.helper_id, (completedMap.get(j.helper_id) || 0) + 1);
    });

    setFavorites(favs.map(f => {
      const ratings = reviewMap.get(f.helper_id) || [];
      return {
        id: f.id,
        helper_id: f.helper_id,
        profile: profileMap.get(f.helper_id) || null,
        stats: {
          completedJobs: completedMap.get(f.helper_id) || 0,
          avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          reviewCount: ratings.length,
        },
      };
    }));
    setLoading(false);
  };

  const removeFavorite = async (favId: string, helperName: string) => {
    await supabase.from("favorite_helpers").delete().eq("id", favId);
    setFavorites(prev => prev.filter(f => f.id !== favId));
    toast.success(`Removed ${helperName} from favorites`);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading…</p></div>;
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader showBack />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Favorite Helprs</h1>
            <p className="text-sm text-muted-foreground mt-1">Helprs you've saved for quick rehiring</p>
          </div>

          {favorites.length === 0 ? (
            <div className="text-center py-16">
              <Heart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No favorite helprs yet</p>
              <p className="text-xs text-muted-foreground mt-1">Visit a helpr's profile and tap the heart icon to save them</p>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map(fav => {
                const p = fav.profile;
                const initials = (p?.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
                return (
                  <div
                    key={fav.id}
                    className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate(`/user/${fav.helper_id}`)}
                  >
                    <div className="flex items-center gap-3">
                      {p?.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                          {initials}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground">{p?.full_name || "User"}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          {p?.location && (
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.location}</span>
                          )}
                          {fav.stats.reviewCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3 fill-primary text-primary" />
                              {fav.stats.avgRating.toFixed(1)} ({fav.stats.reviewCount})
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {fav.stats.completedJobs} jobs
                          </span>
                          {p?.hourly_rate && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />${p.hourly_rate}/hr
                            </span>
                          )}
                        </div>
                        {p?.skills && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {p.skills.split(",").slice(0, 3).map((s, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">{s.trim()}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={(e) => { e.stopPropagation(); removeFavorite(fav.id, p?.full_name || "helpr"); }}
                      >
                        <Heart className="w-4 h-4 fill-destructive text-destructive" />
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

export default FavoriteHelpers;
