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
  const [liveJobs, setLiveJobs] = useState<LiveJob[]>([]);

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
    // Real recent open jobs for the social-proof row (only renders if >=3)
    supabase
      .from("open_jobs_browse")
      .select("id,title,location,budget,category")
      .order("created_at", { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (data) setLiveJobs(data as LiveJob[]);
      });
  }, []);

  return (
    <section
      className="relative w-full max-w-full pt-20 sm:pt-24 lg:pt-28 pb-12 sm:pb-16 md:pb-20 lg:pb-24 px-4 sm:px-6 flex items-start sm:items-center min-h-[80vh] sm:min-h-screen md:min-h-screen lg:min-h-screen"
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
        <div className="grid min-w-0 md:grid-cols-12 gap-8 lg:gap-10 items-center text-center md:text-left">
          {/* LEFT: copy + CTAs (7 cols on desktop for editorial feel) */}
          <div className="md:col-span-7 min-w-0 max-w-full animate-fade-in">
            <div className="w-full max-w-[34rem] mx-auto md:mx-0">
              {/* Eyebrow badge */}
              <div className="inline-flex max-w-full items-center gap-2 px-3 py-1 rounded-full bg-secondary/80 backdrop-blur text-secondary-foreground text-[11px] sm:text-xs font-medium tracking-wide uppercase shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="truncate">Built in Louisiana, for Louisiana</span>
              </div>

              {/* Headline + subhead */}
              <h1 className="mt-7 sm:mt-8 text-[2rem] sm:text-4xl lg:text-5xl font-display font-bold text-foreground leading-[1.15] text-balance break-words">
                Your local{" "}
                <span className="relative inline">
                  <span className="relative z-10 text-primary">task partner.</span>
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-1 h-3 bg-primary/20 -z-0 rounded"
                  />
                </span>
              </h1>

              <p className="mt-5 sm:mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
                Hire a Helpr or find local work. Your trusted Louisiana partner for everyday tasks.
              </p>

              {/* 3-step How it works */}
              <div className="mt-8 sm:mt-10 grid grid-cols-3 gap-3 sm:gap-4 max-w-md mx-auto md:mx-0">
                {[
                  { n: "1", label: "Post" },
                  { n: "2", label: "Match" },
                  { n: "3", label: "Done" },
                ].map((s, i) => (
                  <div key={s.n} className="relative flex flex-col items-center md:items-start gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold border border-primary/20">
                        {s.n}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{s.label}</span>
                    {i < 2 && (
                      <span
                        aria-hidden
                        className="hidden md:block absolute top-3.5 left-9 w-[calc(100%-2.25rem)] h-px bg-gradient-to-r from-primary/30 to-transparent"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Category pills */}
              <div className="relative w-full mt-8 sm:mt-10">
                <div className="w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
                  <div className="flex min-w-max gap-2 pb-1 pr-8">
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
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
                />
              </div>

              {/* CTAs */}
              <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto md:mx-0">
                <Button
                  variant="hero"
                  size="xl"
                  className="group flex-1 px-3"
                  onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
                >
                  <span className="relative z-10">Post a job</span>
                  <ArrowRight className="relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
                <Button
                  variant="hero-outline"
                  size="xl"
                  className="group flex-1 px-3"
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

              {/* Trust strip */}
              <div className="mt-6 flex flex-wrap items-center justify-center md:justify-start gap-x-5 gap-y-2 text-[11px] sm:text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-primary" />
                  Escrow protected
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  Verified helprs
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-primary" />
                  Louisiana-based support
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: image with floating cards (5 cols) */}
          <div className="md:col-span-5 relative min-w-0 max-w-full animate-fade-in [animation-delay:200ms]">
            <div className="relative w-full max-w-[22rem] sm:max-w-md mx-auto md:ml-auto md:mr-0">
              {/* Decorative offset gradient behind image */}
              <div
                aria-hidden
                className="absolute inset-0 translate-x-3 translate-y-3 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/20 blur-sm"
              />
              <img
                src={heroImg400}
                srcSet={heroSrcSet}
                sizes="(max-width: 1023px) 400px, 500px"
                alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
                className="relative w-full h-auto rounded-2xl shadow-2xl object-contain ring-1 ring-border/50"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                width={1000}
                height={1000}
              />

              {/* Floating live-job card (top-left) */}
              {liveJobs[0] && (
                <div className="hidden sm:flex absolute -top-4 -left-6 lg:-left-10 items-center gap-2.5 p-3 pr-4 rounded-xl bg-card/95 backdrop-blur border border-border shadow-xl animate-fade-in [animation-delay:600ms] opacity-0 max-w-[14rem]">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                    {(() => {
                      const Icon = CATEGORY_ICONS[liveJobs[0].category] ?? MoreHorizontal;
                      return <Icon className="w-4 h-4 text-primary" />;
                    })()}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-xs font-semibold text-foreground truncate leading-tight">
                      {liveJobs[0].title}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate mt-0.5">
                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                      {liveJobs[0].location}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary tabular-nums">
                      ${Math.round(Number(liveJobs[0].budget))}
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
