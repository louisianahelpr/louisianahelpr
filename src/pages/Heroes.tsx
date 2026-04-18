import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Award, Star, MapPin, Briefcase, Trophy, Crown, Medal, ArrowLeft } from "lucide-react";
import { formatName } from "@/lib/utils";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

interface Hero {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  parish: string | null;
  skills: string | null;
  subscription_tier: string | null;
  avg_rating: number;
  review_count: number;
  completed_jobs: number;
  hero_score: number;
}

interface ParishOption {
  parish: string;
  hero_count: number;
}

const SITE_URL = "https://louisianahelpr.com";

const Heroes = () => {
  const navigate = useNavigate();
  const [parishes, setParishes] = useState<ParishOption[]>([]);
  const [selectedParish, setSelectedParish] = useState<string>("all");
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);

  usePageMeta({
    title: "Community Heroes — Top-Rated Helprs in Louisiana | Helpr",
    description:
      "Meet Louisiana's top-rated Helprs by parish. Trusted, vetted neighbors with proven 5-star track records in cleaning, yard work, handyman, moving and more.",
    keywords: "Louisiana top helpers, best handymen Louisiana, top rated cleaners, parish leaderboard, community heroes",
    canonical: `${SITE_URL}/heroes`,
    ogTitle: "Louisiana's Community Heroes — Top Helprs by Parish",
    ogDescription: "Discover the highest-rated, most-trusted helprs in your parish.",
    geoRegion: "US-LA",
    geoPlacename: "Louisiana",
  });

  useEffect(() => {
    supabase.rpc("get_hero_parishes").then(({ data }) => {
      if (data) setParishes(data);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const parishParam = selectedParish === "all" ? null : selectedParish;
    supabase
      .rpc("get_top_helpers_by_parish", { p_parish: parishParam, p_limit: 25 })
      .then(({ data }) => {
        setHeroes((data || []) as Hero[]);
        setLoading(false);
      });
  }, [selectedParish]);

  const rankIcon = (rank: number) => {
    if (rank === 0) return <Crown className="w-5 h-5 text-yellow-500" />;
    if (rank === 1) return <Trophy className="w-5 h-5 text-gray-400" />;
    if (rank === 2) return <Medal className="w-5 h-5 text-amber-700" />;
    return <span className="text-sm font-bold text-muted-foreground">#{rank + 1}</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>

        <header className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary mb-4">
            <Award className="w-4 h-4" />
            <span className="text-sm font-semibold">Louisiana Community Heroes</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground mb-3">
            Top-Rated Helprs in Your Parish
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our highest-rated, most-trusted neighbors. Ranked by a balanced score of star
            rating, review count and completed jobs. Updated in real time.
          </p>
        </header>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center mb-8">
          <label className="text-sm font-medium text-foreground">Filter by Parish:</label>
          <Select value={selectedParish} onValueChange={setSelectedParish}>
            <SelectTrigger className="w-[260px] bg-card">
              <SelectValue placeholder="All Parishes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Parishes ({heroes.length} heroes)</SelectItem>
              {parishes.map((p) => (
                <SelectItem key={p.parish} value={p.parish}>
                  {p.parish} ({p.hero_count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : heroes.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
            <Award className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-display font-semibold text-foreground">No heroes yet in this parish</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Helprs need at least 3 reviews and a 4.5★ average to qualify. Be the first!
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {heroes.map((h, i) => {
              const initials = formatName(h.full_name, "?")
                .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
              const badges = computeBadges({
                avgRating: h.avg_rating,
                reviewCount: h.review_count,
                completedJobs: h.completed_jobs,
                helprTier: h.subscription_tier,
              });

              return (
                <li
                  key={h.user_id}
                  onClick={() => navigate(`/user/${h.user_id}`)}
                  className="group flex items-center gap-4 p-4 rounded-2xl border border-border bg-card hover:bg-accent/50 hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex-shrink-0 w-10 flex items-center justify-center">
                    {rankIcon(i)}
                  </div>

                  {h.avatar_url ? (
                    <img
                      src={h.avatar_url}
                      alt={formatName(h.full_name, "Helpr")}
                      className="w-14 h-14 rounded-full object-cover border-2 border-primary/20 flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold flex-shrink-0">
                      {initials}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-semibold text-foreground truncate">
                        {formatName(h.full_name, "Helpr")}
                      </h3>
                      <HelperBadges badges={badges} />
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                      {h.parish && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {h.parish}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-foreground">
                        <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                        {h.avg_rating.toFixed(1)}{" "}
                        <span className="text-muted-foreground">({h.review_count})</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Briefcase className="w-3.5 h-3.5" /> {h.completed_jobs} jobs
                      </span>
                    </div>
                    {h.skills && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {h.skills}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="text-xs text-muted-foreground text-center mt-8 max-w-xl mx-auto">
          Hero rank = avg rating × log(review count + 1) + (completed jobs × 0.1).
          Minimum: 3 reviews and 4.5★ average. Refreshed live.
        </p>
      </main>

      <Footer />
    </div>
  );
};

export default Heroes;
