import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Users, CheckCircle } from "lucide-react";
import heroImg from "@/assets/hero-illustration-v5.webp";

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
      className="pt-32 pb-20 px-6 min-h-[100dvh] lg:min-h-0 flex items-center lg:block"
      style={{
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
      }}
    >
      <div className="container mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center text-center lg:text-left">
          <div className="space-y-6 animate-fade-in">
            <div className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium tracking-wide uppercase">
              Serving Louisiana communities
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-foreground leading-tight text-balance">
              Louisiana's helping hand for everyday tasks
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
              Helpr connects you with trusted neighbors across Louisiana for everyday tasks — cleaning, errands, moving, yard work, and more.
            </p>

            {/* Social proof — only show when numbers are meaningful */}
            {stats && (stats.users >= 50 || stats.completed >= 20) && (
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                {stats.users >= 50 && (
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{stats.users.toLocaleString()}</span> community members
                  </span>
                )}
                {stats.completed >= 20 && (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{stats.completed.toLocaleString()}</span> tasks completed
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              {loggedIn ? (
                <>
                  <Button variant="hero" size="xl" onClick={() => navigate("/dashboard")}>
                    Browse jobs
                  </Button>
                  <Button variant="hero-outline" size="xl" onClick={() => navigate("/post-job")}>
                    Post a task
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="hero" size="xl" onClick={() => navigate("/signup")}>
                    Post your first task
                  </Button>
                  <Button variant="hero-outline" size="xl" onClick={() => navigate("/login")}>
                    Offer help today
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="animate-fade-in [animation-delay:200ms]">
            <img src={heroImg} alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees" className="w-full rounded-2xl shadow-lg" loading="eager" width={1200} height={800} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
