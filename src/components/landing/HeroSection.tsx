import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  CheckCircle,
  Leaf,
  Sparkles,
  Truck,
  Heart,
  Star,
  MapPin,
  DollarSign,
} from "lucide-react";
import heroImg from "@/assets/hero-illustration-v5-1000.webp";

const categories = [
  { icon: Leaf, label: "Yard Work" },
  { icon: Sparkles, label: "Cleaning" },
  { icon: Truck, label: "Moving" },
  { icon: Heart, label: "Senior Help" },
];

const mockJobs = [
  {
    title: "Lawn mowing & trim",
    location: "Delcambre, LA",
    price: "$85",
    icon: Leaf,
    rating: "4.9",
    accent: "from-primary/20 to-primary/5",
  },
  {
    title: "Deep clean — 3 BR",
    location: "Erath, LA",
    price: "$160",
    icon: Sparkles,
    rating: "5.0",
    accent: "from-accent/30 to-accent/5",
  },
  {
    title: "Help moving couch",
    location: "Lafayette, LA",
    price: "$75",
    icon: Truck,
    rating: "4.8",
    accent: "from-secondary/40 to-secondary/5",
  },
];

const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  const [stats, setStats] = useState<{ users: number; completed: number } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setLoggedIn(true);
    });
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
      className="relative pt-20 sm:pt-24 lg:pt-28 pb-10 sm:pb-16 px-6 min-h-[100dvh] flex items-center overflow-hidden"
      style={{
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
      }}
    >
      {/* Soft brand gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-primary/15 blur-3xl -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 w-[420px] h-[420px] rounded-full bg-accent/20 blur-3xl -z-10"
      />

      <div className="container mx-auto">
        <div className="grid md:grid-cols-2 gap-10 lg:gap-12 items-center text-center md:text-left">
          {/* LEFT: copy + CTAs */}
          <div className="space-y-5 sm:space-y-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/80 backdrop-blur text-secondary-foreground text-[11px] sm:text-xs font-medium tracking-wide uppercase shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Built in Louisiana, for Louisiana
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-6xl font-display font-bold text-foreground leading-tight text-balance">
              Get real help from{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-primary">real neighbors.</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 h-3 bg-primary/20 -z-0 rounded"
                />
              </span>
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto md:mx-0 leading-relaxed">
              Post a job, get matched with trusted local helprs, and pay securely when the work's done.
            </p>

            {/* Category pills */}
            <div className="flex flex-wrap justify-center md:justify-start gap-2">
              {categories.map((c) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur border border-border/60 text-xs sm:text-sm font-medium text-foreground shadow-sm hover:border-primary/40 hover:bg-card transition-colors"
                >
                  <c.icon className="w-3.5 h-3.5 text-primary" />
                  {c.label}
                </span>
              ))}
            </div>

            {/* Social proof */}
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

          {/* RIGHT: image */}
          <div className="relative animate-fade-in [animation-delay:200ms] px-2 sm:px-0 md:flex md:justify-center lg:justify-end">
            <div className="relative w-full max-w-md mx-auto">
              <img
                src={heroImg}
                alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
                className="w-full h-auto rounded-2xl shadow-xl object-contain"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                width={1000}
                height={1000}
              />
            </div>
          </div>
        </div>

        {/* Live job cards row — under buttons + image */}
        <div className="mt-10 sm:mt-14">
          <p className="text-center text-xs uppercase tracking-widest text-muted-foreground mb-4">
            Recently posted in Louisiana
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {mockJobs.map((job, i) => {
              const Icon = job.icon;
              const floatClass = i === 1 ? "animate-float-slower" : "animate-float-slow";
              const delay = i === 1 ? "" : i === 2 ? "[animation-delay:1.5s]" : "";
              return (
                <div
                  key={job.title}
                  className={`flex items-center gap-3 p-4 rounded-xl bg-card/95 backdrop-blur border border-border/60 shadow-lg hover:shadow-xl hover:border-primary/40 transition-all ${floatClass} ${delay}`}
                >
                  <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${job.accent} flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-foreground truncate">{job.title}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {job.location}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary flex items-center justify-end">
                      <DollarSign className="w-3 h-3" />
                      {job.price.replace("$", "")}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
                      <Star className="w-2.5 h-2.5 fill-primary text-primary" />
                      {job.rating}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
