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
  Shield,
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
      className="relative w-full max-w-full pt-20 sm:pt-24 lg:pt-28 pb-0 px-4 sm:px-6 flex flex-col min-h-[80vh] sm:min-h-screen"
      style={{
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      {/* Z-pattern brand gradient backdrop */}
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

      {/* MAIN: split-screen hero */}
      <div className="flex-1 mx-auto w-full max-w-7xl min-w-0 flex items-center pb-10 sm:pb-14">
        <div className="grid min-w-0 md:grid-cols-2 gap-6 lg:gap-10 items-center w-full text-center md:text-left">
          {/* LEFT: copy + CTAs, shifted toward center */}
          <div className="md:pl-4 lg:pl-10 min-w-0 max-w-full animate-fade-in">
            <div className="w-full max-w-xl mx-auto md:mx-0">
              {/* Eyebrow badge — Louisiana stamp */}
              <div className="inline-flex max-w-full items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 backdrop-blur border border-primary/20 text-primary text-[11px] sm:text-xs font-bold tracking-wider uppercase shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="truncate">Made in Louisiana · Bayou Built</span>
              </div>

              {/* Headline — tightened */}
              <h1 className="mt-5 text-[2.25rem] sm:text-5xl lg:text-[3.75rem] font-display font-bold text-foreground leading-[1.05] tracking-tight text-balance break-words">
                Your local{" "}
                <span className="relative inline">
                  <span className="relative z-10 text-primary">task partner.</span>
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-1 h-3 sm:h-4 bg-primary/20 -z-0 rounded"
                  />
                </span>
              </h1>

              {/* Subhead — tighter spacing, heavier weight for contrast */}
              <p className="mt-3 sm:mt-4 text-base sm:text-lg text-foreground/80 font-medium leading-snug max-w-lg mx-auto md:mx-0">
                Hire a Helpr or find local work. Your trusted Louisiana partner for everyday tasks.
              </p>

              {/* 3-step How it works */}
              <div className="mt-7 flex items-center justify-center md:justify-start gap-4 sm:gap-6 flex-wrap">
                {[
                  { n: "1", label: "Post" },
                  { n: "2", label: "Match" },
                  { n: "3", label: "Done" },
                ].map((s, i) => (
                  <div key={s.n} className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold border border-primary/20">
                        {s.n}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{s.label}</span>
                    </div>
                    {i < 2 && (
                      <span aria-hidden className="hidden sm:block w-6 h-px bg-border" />
                    )}
                  </div>
                ))}
              </div>

              {/* Category pills — bigger, interactive */}
              <div className="relative w-full mt-7">
                <div className="w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
                  <div className="flex min-w-max gap-2.5 pb-2 pr-8">
                    {categories.map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
                        className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-card/80 backdrop-blur border border-border/60 text-sm font-medium text-foreground shadow-sm hover:border-primary/50 hover:bg-card hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 whitespace-nowrap shrink-0"
                      >
                        <c.icon className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
                />
              </div>

              {/* CTAs — strong hierarchy: primary solid, secondary ghost */}
              <div className="mt-7 flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto md:mx-0">
                <Button
                  variant="hero"
                  size="xl"
                  className="group flex-1 px-3 shadow-xl shadow-primary/20"
                  onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
                >
                  <span className="relative z-10">Post a job</span>
                  <ArrowRight className="relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
                <Button
                  variant="ghost"
                  size="xl"
                  className="group flex-1 px-3 text-foreground/80 hover:text-foreground hover:bg-card/60"
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
            </div>
          </div>

          {/* RIGHT: bigger image, fills the right half */}
          <div className="relative min-w-0 max-w-full animate-fade-in [animation-delay:200ms]">
            <div className="relative w-full max-w-[26rem] sm:max-w-[30rem] lg:max-w-[34rem] mx-auto md:ml-auto md:mr-0">
              {/* Decorative offset gradient behind image */}
              <div
                aria-hidden
                className="absolute inset-0 translate-x-4 translate-y-4 rounded-3xl bg-gradient-to-br from-primary/30 to-accent/20 blur-md"
              />
              <img
                src={heroImg400}
                srcSet={heroSrcSet}
                sizes="(max-width: 1023px) 416px, 544px"
                alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
                className="relative w-full h-auto rounded-3xl shadow-2xl object-contain ring-1 ring-border/50"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                width={1000}
                height={1000}
              />

              {/* Floating live-job card */}
              {liveJobs[0] && (
                <div className="hidden sm:flex absolute -bottom-5 -left-6 lg:-left-12 items-center gap-2.5 p-3 pr-4 rounded-xl bg-card/95 backdrop-blur border border-border shadow-xl animate-fade-in [animation-delay:600ms] opacity-0 max-w-[14rem]">
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

      {/* FULL-WIDTH TRUST BAR — anchors the hero */}
      <div className="relative w-screen left-1/2 -translate-x-1/2 border-t border-border/50 bg-card/40 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs sm:text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground/80">Escrow protected</span>
          </span>
          <span className="hidden sm:inline-block w-px h-4 bg-border" />
          <span className="inline-flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground/80">Verified helprs</span>
          </span>
          <span className="hidden sm:inline-block w-px h-4 bg-border" />
          <span className="inline-flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground/80">Louisiana-based support</span>
          </span>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
