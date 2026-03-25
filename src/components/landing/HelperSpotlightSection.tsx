import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Star, MapPin, Briefcase, Award } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";

interface SpotlightHelper {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  skills: string | null;
  subscription_tier: string | null;
  avgRating: number;
  reviewCount: number;
  completedJobs: number;
}

const HelperSpotlightSection = () => {
  const navigate = useNavigate();
  const [helpers, setHelpers] = useState<SpotlightHelper[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Get approved helpers via secure RPC
      const { data: profiles } = await supabase.rpc("get_approved_helpers", { max_count: 20 });

      if (!profiles || profiles.length === 0) { setLoaded(true); return; }

      const ids = profiles.map(p => p.user_id);
      const [reviewsRes, jobsRes] = await Promise.all([
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", ids),
        supabase.from("jobs").select("helper_id").in("helper_id", ids).eq("status", "completed"),
      ]);

      const ratingMap = new Map<string, number[]>();
      reviewsRes.data?.forEach(r => {
        if (!ratingMap.has(r.reviewee_id)) ratingMap.set(r.reviewee_id, []);
        ratingMap.get(r.reviewee_id)!.push(r.rating);
      });
      const jobMap = new Map<string, number>();
      jobsRes.data?.forEach(j => {
        if (j.helper_id) jobMap.set(j.helper_id, (jobMap.get(j.helper_id) || 0) + 1);
      });

      const enriched: SpotlightHelper[] = profiles.map(p => {
        const ratings = ratingMap.get(p.user_id) || [];
        return {
          ...p,
          subscription_tier: (p as any).subscription_tier || null,
          avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          reviewCount: ratings.length,
          completedJobs: jobMap.get(p.user_id) || 0,
        };
      });

      // Landing Page Spotlight: Only show Elite subscribers
      const top = enriched
        .filter(h => h.subscription_tier === "elite" && h.reviewCount > 0)
        .sort((a, b) => (b.avgRating * b.reviewCount) - (a.avgRating * a.reviewCount))
        .slice(0, 3);

      setHelpers(top);
      setLoaded(true);
    };
    load();
  }, []);

  if (!loaded || helpers.length === 0) return null;

  return (
    <section className="py-24 px-4 bg-secondary/50">
      <div className="container mx-auto text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Award className="w-6 h-6 text-primary" />
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground">
            Helpr Spotlight
          </h2>
        </div>
        <p className="text-muted-foreground max-w-md mx-auto mb-12">
          Meet some of our top-rated members making a difference in Louisiana
        </p>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {helpers.map((h, i) => {
            const initials = formatName(h.full_name, "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
            const badges = computeBadges({ avgRating: h.avgRating, reviewCount: h.reviewCount, completedJobs: h.completedJobs, helprTier: h.subscription_tier });

            return (
              <div
                key={h.user_id}
                className="rounded-2xl border border-border bg-card p-6 text-center hover:shadow-lg transition-shadow cursor-pointer animate-fade-in opacity-0"
                style={{ animationDelay: `${i * 150}ms` }}
                onClick={() => navigate(`/user/${h.user_id}`)}
              >
                {h.avatar_url ? (
                  <img src={h.avatar_url} alt="" className="w-20 h-20 rounded-full mx-auto object-cover border-2 border-primary/20" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-2xl font-bold">
                    {initials}
                  </div>
                )}
                <h3 className="text-lg font-display font-semibold text-foreground mt-3">{formatName(h.full_name, "Helpr")}</h3>
                {h.location && (
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <MapPin className="w-3 h-3" /> {h.location}
                  </p>
                )}
                <div className="flex items-center justify-center gap-3 mt-2 text-sm">
                  {h.reviewCount > 0 && (
                    <span className="flex items-center gap-1 text-foreground">
                      <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                      {h.avgRating.toFixed(1)} <span className="text-muted-foreground">({h.reviewCount})</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Briefcase className="w-3.5 h-3.5" /> {h.completedJobs} jobs
                  </span>
                </div>
                <div className="flex justify-center mt-2">
                  <HelperBadges badges={badges} />
                </div>
                {h.bio && (
                  <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{h.bio}</p>
                )}
                {h.skills && (
                  <div className="flex flex-wrap gap-1 justify-center mt-3">
                    {h.skills.split(",").slice(0, 3).map((s, j) => (
                      <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{s.trim()}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HelperSpotlightSection;
