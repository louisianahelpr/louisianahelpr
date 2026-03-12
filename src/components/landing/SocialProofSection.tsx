import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, Users, TrendingUp } from "lucide-react";

const SocialProofSection = () => {
  const [stats, setStats] = useState({ completedJobs: 0, totalUsers: 0, avgRating: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadStats = async () => {
      const [jobsRes, usersRes, reviewsRes] = await Promise.all([
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
        supabase.rpc("count_profiles"),
        supabase.from("reviews").select("rating"),
      ]);

      const ratings = reviewsRes.data?.map(r => r.rating) || [];
      setStats({
        completedJobs: jobsRes.count || 0,
        totalUsers: (usersRes.data as number) || 0,
        avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
      });
      setLoaded(true);
    };
    loadStats();
  }, []);

  // Animate counter
  const AnimatedNumber = ({ value, suffix = "" }: { value: number; suffix?: string }) => {
    const [display, setDisplay] = useState(0);
    useEffect(() => {
      if (!loaded) return;
      const duration = 1500;
      const steps = 40;
      const increment = value / steps;
      let current = 0;
      const timer = setInterval(() => {
        current += increment;
        if (current >= value) { setDisplay(value); clearInterval(timer); }
        else setDisplay(Math.floor(current));
      }, duration / steps);
      return () => clearInterval(timer);
    }, [value, loaded]);
    return <>{display.toLocaleString()}{suffix}</>;
  };

  const items = [
    { icon: CheckCircle, value: stats.completedJobs, label: "Jobs completed", suffix: "+" },
    { icon: Users, value: stats.totalUsers, label: "Users", suffix: "+" },
    { icon: TrendingUp, value: parseFloat(stats.avgRating.toFixed(1)) || 4.9, label: "Average rating", suffix: "★" },
  ];

  return (
    <section className="py-16 px-4 border-t border-border">
      <div className="container mx-auto">
        <div className="grid grid-cols-3 gap-6 max-w-3xl mx-auto">
          {items.map((item, i) => (
            <div
              key={item.label}
              className="text-center animate-fade-in opacity-0"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <item.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-3xl font-display font-bold text-foreground">
                {!loaded ? (
                  <span className="inline-block w-16 h-8 bg-muted animate-pulse rounded" />
                ) : item.label === "Average rating" ? (
                  <>{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "4.9"}{item.suffix}</>
                ) : (
                  <AnimatedNumber value={item.value} suffix={item.suffix} />
                )}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SocialProofSection;
