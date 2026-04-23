import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Users, CheckCircle } from "lucide-react";
import heroImg from "@/assets/hero-illustration-v5-1000.webp";

const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  const [stats, setStats] = useState<{ users: number; completed: number } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setLoggedIn(true);
    });
    // Fetch social proof stats
    Promise.all([
      supabase.rpc("count_profiles"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
    ]).then(([profilesRes, jobsRes]) => {
      setStats({
        users: typeof profilesRes.data === "number" ? profilesRes.data : 0,
        completed: jobsRes.count || 0,
      });
    });
  }, []);

  return (
    <section
      className="pt-20 sm:pt-24 lg:pt-28 pb-10 sm:pb-16 px-6 min-h-[100dvh] flex items-center"
      style={{
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
      }}
    >
      <div className="container mx-auto">
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-center md:items-center lg:items-start text-center md:text-left">
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            <div className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-[11px] sm:text-xs font-medium tracking-wide uppercase">
              Built in Louisiana, for Louisiana
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-6xl font-display font-bold text-foreground leading-tight text-balance">
              Get real help from real neighbors.
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Post a job, get matched with trusted local helprs, and pay securely when the work's done. Cleaning, yard work, moving, errands — all in one app.
            </p>

            {/* Social proof — only show when we have 50+ users AND 50+ completed jobs */}
            {stats && stats.users >= 50 && stats.completed >= 50 && (
              <div className="flex flex-wrap justify-center md:justify-start gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-foreground">{stats.users.toLocaleString()}</span> neighbors
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-foreground">{stats.completed.toLocaleString()}</span> jobs done
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-2 max-w-md mx-auto md:mx-0">
              <Button
                variant="hero"
                size="xl"
                className="w-full"
                onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
              >
                Post a job
              </Button>
              <Button
                variant="hero-outline"
                size="xl"
                className="w-full"
                onClick={() => navigate(loggedIn ? "/dashboard" : "/jobs")}
              >
                Browse jobs
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/80 pt-1">
              Free to join · No subscription · Pay only when you post
            </p>
          </div>
          <div className="animate-fade-in [animation-delay:200ms] px-2 sm:px-0 md:flex md:justify-center md:items-center lg:justify-end lg:items-start">
            <img
              src={heroImg}
              alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
              className="w-full h-auto rounded-2xl shadow-lg object-contain md:max-w-sm lg:max-w-md"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              width={1000}
              height={1000}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
