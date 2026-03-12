import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Heart, MapPin, Star, Briefcase, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

interface SafeProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  skills: string | null;
  hourly_rate: number | null;
  role: string;
  subscription_tier: string | null;
  portfolio_urls: string[] | null;
  created_at: string;
}

interface FavoriteHelper {
  id: string;
  helper_id: string;
  profile: SafeProfile | null;
  stats: { completedJobs: number; avgRating: number; reviewCount: number };
}

const FavoritesPanel = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteHelper[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFavorites = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setLoading(false); return; }

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
      supabase.rpc("get_safe_profiles", { user_ids: helperIds }),
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

  useEffect(() => {
    if (open) loadFavorites();
  }, [open]);

  const removeFavorite = async (favId: string, helperName: string) => {
    await supabase.from("favorite_helpers").delete().eq("id", favId);
    setFavorites(prev => prev.filter(f => f.id !== favId));
    toast.success(`Removed ${helperName} from favorites`);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Favorite Helpers" className="hover:bg-accent/20 hover:text-accent-foreground btn-press rounded-xl h-9 w-9">
          <Heart className="w-4 h-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="font-display">Favorite Helprs</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto max-h-[calc(100vh-5rem)] p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
          ) : favorites.length === 0 ? (
            <div className="text-center py-16">
              <Heart className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No favorite helprs yet</p>
              <p className="text-xs text-muted-foreground mt-1">Visit a helpr's profile and tap the heart icon</p>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map(fav => {
                const p = fav.profile;
                const initials = (p?.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
                return (
                  <div
                    key={fav.id}
                    className="rounded-xl border border-border bg-card p-3 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => { setOpen(false); navigate(`/user/${fav.helper_id}`); }}
                  >
                    <div className="flex items-center gap-3">
                      {p?.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                          {initials}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-foreground">{p?.full_name || "User"}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          {p?.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.location}</span>}
                          {fav.stats.reviewCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3 fill-primary text-primary" />
                              {fav.stats.avgRating.toFixed(1)}
                            </span>
                          )}
                          <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{fav.stats.completedJobs} jobs</span>
                          {p?.hourly_rate && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />${p.hourly_rate}/hr</span>}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
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
      </SheetContent>
    </Sheet>
  );
};

export default FavoritesPanel;
