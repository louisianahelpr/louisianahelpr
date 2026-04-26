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
  Wrench,
  Paintbrush,
  Package,
  PawPrint,
  Hammer,
  ShoppingBag,
  MoreHorizontal,
  ArrowRight,
  Search,
} from "lucide-react";
import heroImg from "@/assets/hero-illustration-v5-1000.webp";
import heroImg400 from "@/assets/hero-illustration-v5-400.webp";
import heroImg500 from "@/assets/hero-illustration-v5-500.webp";
import heroImg600 from "@/assets/hero-illustration-v5-600.webp";

// Responsive srcset — display width is ~497px max (max-w-md = 28rem),
// so mobile devices should use the 400/500w variant (~41–58 KB) instead
// of the 1000w variant (~150 KB). Saves ~110 KB on mobile LCP.
const heroSrcSet = `${heroImg400} 400w, ${heroImg500} 500w, ${heroImg600} 600w, ${heroImg} 1000w`;

// Inject a <link rel="preload"> for the LCP hero image as soon as this module
// loads, so the browser can discover the request before React renders the <img>.
// Fixes Lighthouse "LCP request discovery" — the image is otherwise only
// findable after the JS bundle parses and renders, costing ~1s on mobile.
if (typeof document !== "undefined") {
  const PRELOAD_ID = "hero-lcp-preload";
  if (!document.getElementById(PRELOAD_ID)) {
    const link = document.createElement("link");
    link.id = PRELOAD_ID;
    link.rel = "preload";
    link.as = "image";
    link.type = "image/webp";
    link.fetchPriority = "high";
    link.href = heroImg400;
    link.setAttribute("imagesrcset", heroSrcSet);
    link.setAttribute("imagesizes", "(max-width: 1023px) 400px, 500px");
    document.head.appendChild(link);
  }
}

const categories = [
  { icon: Leaf, label: "Yard Work" },
  { icon: Sparkles, label: "Cleaning" },
  { icon: Truck, label: "Moving" },
  { icon: ShoppingBag, label: "Errands" },
  { icon: Wrench, label: "Handyman" },
  { icon: Paintbrush, label: "Painting" },
  { icon: Package, label: "Delivery" },
  { icon: PawPrint, label: "Pet Care" },
  { icon: Hammer, label: "Assembly" },
  { icon: Heart, label: "Senior Help" },
  { icon: MoreHorizontal, label: "More" },
];

const CATEGORY_ICONS: Record<string, typeof Leaf> = {
  yard_work: Leaf,
  cleaning: Sparkles,
  moving: Truck,
  errands: ShoppingBag,
  handyman: Wrench,
  painting: Paintbrush,
  delivery: Package,
  pet_care: PawPrint,
  assembly: Hammer,
  senior_help: Heart,
  other: MoreHorizontal,
};

const CATEGORY_ACCENTS = [
  "from-primary/20 to-primary/5",
  "from-accent/30 to-accent/5",
  "from-secondary/40 to-secondary/5",
];

type LiveJob = {
  id: string;
  title: string;
  location: string;
  budget: number;
  category: string;
};

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
      className="relative w-full max-w-full pt-20 sm:pt-24 lg:pt-28 pb-10 sm:pb-16 px-4 sm:px-6 flex items-start sm:items-center"
      style={{
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
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

      <div className="mx-auto w-full max-w-6xl min-w-0">
        <div className="grid min-w-0 md:grid-cols-2 gap-8 lg:gap-12 items-center text-center md:text-left">
          {/* LEFT: copy + CTAs */}
          <div className="min-w-0 max-w-full space-y-5 sm:space-y-6 animate-fade-in">
            <div className="inline-flex max-w-full items-center gap-2 px-3 py-1 rounded-full bg-secondary/80 backdrop-blur text-secondary-foreground text-[11px] sm:text-xs font-medium tracking-wide uppercase shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="truncate">Built in Louisiana, for Louisiana</span>
            </div>

            <h1 className="mx-auto max-w-[21rem] text-[2rem] sm:max-w-lg sm:text-4xl lg:text-6xl md:mx-0 font-display font-bold text-foreground leading-[1.08] text-balance break-words">
              Your local{" "}
              <span className="relative inline">
                <span className="relative z-10 text-primary">task partner.</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 h-3 bg-primary/20 -z-0 rounded"
                />
              </span>
            </h1>

            <p className="mx-auto max-w-[21rem] sm:max-w-lg md:mx-0 text-base sm:text-lg text-muted-foreground leading-relaxed">
              The marketplace for everyday help. Post a job in minutes and connect with neighbors who are ready to work.
            </p>

            {/* Category pills - single row, horizontally scrollable */}
            <div className="w-full max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
              <div className="flex min-w-max gap-2 pb-1">
                {categories.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur border border-border/60 text-xs sm:text-sm font-medium text-foreground shadow-sm hover:border-primary/40 hover:bg-card transition-colors whitespace-nowrap shrink-0"
                  >
                    <c.icon className="w-3.5 h-3.5 text-primary" />
                    {c.label}
                  </span>
                ))}
              </div>
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

            <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-2 w-full max-w-[21rem] sm:max-w-md mx-auto md:mx-0">
              <Button
                variant="hero"
                size="xl"
                className="group w-full px-3"
                onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
              >
                <span className="relative z-10">Post a job</span>
                <ArrowRight className="relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <Button
                variant="hero-outline"
                size="xl"
                className="group w-full px-3"
                onClick={() => {
                  if (loggedIn) {
                    navigate("/dashboard");
                    return;
                  }
                  const el = document.getElementById("open-jobs");
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                  } else {
                    navigate("/#open-jobs");
                  }
                }}
              >
                <Search className="transition-transform duration-300 group-hover:scale-110" />
                <span>Browse jobs</span>
              </Button>
            </div>
            <p className="text-[9px] sm:text-xs text-muted-foreground/80 -mt-2 sm:-mt-3">
              Free to join · No subscription · Pay only when you post
            </p>
          </div>

          {/* RIGHT: image */}
          <div className="relative min-w-0 max-w-full animate-fade-in [animation-delay:200ms] px-0 md:flex md:justify-center lg:justify-end">
            <div className="relative w-full max-w-[21rem] sm:max-w-md mx-auto">
              {/* sizes is intentionally tight: the rendered display width is ~497px max
                  (max-w-md = 28rem). Tells the browser to pick the 500w variant on mobile
                  and 600w on tablet, instead of jumping to the full 900w (Lighthouse fix). */}
              <img
                src={heroImg400}
                srcSet={heroSrcSet}
                sizes="(max-width: 1023px) 400px, 500px"
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
        <div className="mt-28 sm:mt-20 pt-4">
          <p className="text-center text-xs uppercase tracking-widest text-muted-foreground mb-4 px-4">
            Recently posted in Louisiana
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {mockJobs.map((job, i) => {
              const Icon = job.icon;
              return (
                <div
                  key={job.title}
                  className="flex items-center gap-3 p-4 rounded-xl bg-card/95 backdrop-blur border border-border/60 shadow-lg hover:shadow-xl hover:border-primary/40 transition-all"
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
