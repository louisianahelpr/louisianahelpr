import { useEffect, useState, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Star, Briefcase, Award, Crown, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { Button } from "@/components/ui/button";

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

const HelperSpotlightSection = forwardRef<HTMLDivElement>((_props, ref) => {
  const navigate = useNavigate();
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Statewide list — parish grouping removed from public UI.
      const { data } = await supabase.rpc("get_top_helpers_by_parish", {
        p_parish: null as unknown as string,
        p_limit: 6,
      });
      if (data) setHeroes(data as Hero[]);
      setLoaded(true);
    };

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    const handle = w.requestIdleCallback
      ? w.requestIdleCallback(() => { load(); }, { timeout: 2500 })
      : window.setTimeout(load, 1500);
    return () => {
      const cancel = (window as Window & {
        cancelIdleCallback?: (h: number) => void;
      }).cancelIdleCallback;
      if (cancel) cancel(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  if (!loaded || heroes.length === 0) return null;

  return (
    <section ref={ref} className="py-16 md:py-20 px-4">
      <div className="container mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary mb-4">
            <Award className="w-4 h-4" />
            <span className="text-sm font-semibold">Community Heroes</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-3">
            Louisiana's Top-Rated Helprs
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Real neighbors making a real difference. Ranked by rating, reviews and completed jobs.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
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
              <div
                key={h.user_id}
                className="relative rounded-2xl border border-border bg-card p-5 text-center hover:shadow-lg hover:border-primary/40 transition-all cursor-pointer animate-fade-in opacity-0"
                style={{ animationDelay: `${i * 100}ms` }}
                onClick={() => navigate(`/user/${h.user_id}`)}
              >
                {i === 0 && (
                  <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full p-1.5 shadow-md">
                    <Crown className="w-3.5 h-3.5" />
                  </div>
                )}
                {h.avatar_url ? (
                  <img
                    src={h.avatar_url}
                    alt=""
                    loading="lazy"
                    className="w-16 h-16 rounded-full mx-auto object-cover border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-xl font-bold">
                    {initials}
                  </div>
                )}
                <h4 className="text-base font-display font-semibold text-foreground mt-3">
                  {formatName(h.full_name, "Helpr")}
                </h4>
                <div className="flex items-center justify-center gap-3 mt-1.5 text-sm">
                  <span className="flex items-center gap-1 text-foreground">
                    <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                    {h.avg_rating.toFixed(1)}{" "}
                    <span className="text-muted-foreground">({h.review_count})</span>
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Briefcase className="w-3.5 h-3.5" /> {h.completed_jobs}
                  </span>
                </div>
                <div className="flex justify-center mt-2">
                  <HelperBadges badges={badges} />
                </div>
                {h.skills && (
                  <div className="flex flex-wrap gap-1 justify-center mt-3">
                    {h.skills.split(",").slice(0, 2).map((s, j) => (
                      <span
                        key={j}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
                      >
                        {s.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-center mt-10">
          <Button onClick={() => navigate("/heroes")} size="lg" variant="outline">
            See the full leaderboard <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </section>
  );
});
HelperSpotlightSection.displayName = "HelperSpotlightSection";

export default HelperSpotlightSection;
