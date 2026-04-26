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
import heroImg from "@/assets/hero-porch-garden.jpg";
import heroImg400 from "@/assets/hero-porch-garden.jpg";

// Single high-quality source — sized to fill the taller right column.
const heroSrcSet = `${heroImg} 1024w`;

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
    link.type = "image/jpeg";
    link.fetchPriority = "high";
    link.href = heroImg;
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
      className="relative w-full max-w-full pt-16 sm:pt-20 lg:pt-28 pb-0 flex flex-col min-h-screen min-h-[100dvh] overflow-hidden"
    >
      {/* MAIN: split-screen, image locked to right edge */}
      <div className="flex-1 w-full min-w-0 grid grid-rows-[auto_1fr] lg:grid-rows-1 lg:grid-cols-2 items-stretch pb-4 sm:pb-6 lg:pb-14">
        {/* LEFT: copy + CTAs — vertically centered against image, bottom aligned to image bottom */}
        <div
          className="min-w-0 max-w-full animate-fade-in px-6 sm:px-10 lg:pl-24 xl:pl-32 lg:pr-8 text-center lg:text-left lg:pt-0 flex flex-col lg:justify-center"
          style={{
            paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
          }}
        >
          <div className="w-full max-w-2xl mx-auto lg:mx-0 flex flex-col gap-4 sm:gap-5 lg:gap-8">
            {/* TOP cluster — copy + categories */}
            <div className="flex flex-col gap-3 sm:gap-4 lg:gap-8">
              {/* Eyebrow — Louisiana stamp */}
              <div className="inline-flex max-w-full self-center lg:self-start items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 backdrop-blur border border-primary/20 text-primary text-[10px] sm:text-xs font-bold tracking-wider uppercase shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="truncate">Made in Louisiana, for Louisiana</span>
              </div>

              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[4.5rem] xl:text-[5rem] font-display font-bold text-foreground leading-[1.02] tracking-tight text-balance break-words">
                Your local{" "}
                <span className="relative inline">
                  <span className="relative z-10 text-primary">task partner.</span>
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-1 h-3 sm:h-4 lg:h-6 bg-primary/20 -z-0 rounded"
                  />
                </span>
              </h1>

              {/* Subhead */}
              <p className="text-base sm:text-lg text-foreground/75 font-medium leading-snug max-w-xl mx-auto lg:mx-0 lg:text-xl font-sans">
                Hire a Helpr or find local work. Your trusted Louisiana partner for everyday tasks.
              </p>

              {/* Category pills */}
              <div className="relative w-full">
                <div className="w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
                  <div className="flex min-w-max gap-3 pb-2 pr-8">
                    {categories.map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
                        className="group inline-flex items-center gap-2 px-4 py-2 lg:px-5 lg:py-3 rounded-full bg-card/80 backdrop-blur border border-border/60 text-sm lg:text-base font-medium text-foreground shadow-sm hover:border-primary/50 hover:bg-card hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 whitespace-nowrap shrink-0"
                      >
                        <c.icon className="w-4 h-4 lg:w-5 lg:h-5 text-primary group-hover:scale-110 transition-transform" />
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
            </div>

            {/* BOTTOM: CTAs grouped tightly under the content stack — centered on mobile/iPad */}
            <div className="flex flex-col items-stretch gap-3 lg:gap-4 w-full max-w-md lg:max-w-xl mx-auto lg:mx-0">
              <Button
                size="xl"
                className="group w-full h-12 sm:h-14 lg:h-16 px-6 lg:px-8 rounded-xl text-base lg:text-lg font-semibold tracking-tight bg-primary text-primary-foreground shadow-[0_12px_32px_-10px_hsl(var(--primary)/0.55)] hover:bg-primary/95 hover:shadow-[0_16px_40px_-10px_hsl(var(--primary)/0.7)] hover:-translate-y-0.5 transition-all duration-300"
                onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
              >
                <Sparkles className="mr-2 w-5 h-5" />
                Post a job
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <Button
                variant="outline"
                size="xl"
                className="group w-full h-16 px-8 rounded-xl text-lg font-semibold tracking-tight bg-card border-2 border-primary/40 text-primary shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.35)] hover:bg-primary/5 hover:border-primary hover:shadow-[0_12px_32px_-10px_hsl(var(--primary)/0.5)] hover:-translate-y-0.5 transition-all duration-300"
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
                <Search className="mr-2 w-5 h-5" />
                Browse jobs
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        </div>

        {/* RIGHT: full-bleed image — full width on phone & tablet, locked to right edge on desktop */}
        <div className="relative min-w-0 max-w-full animate-fade-in [animation-delay:200ms] mt-6 lg:mt-0 self-stretch flex-1 lg:flex-none flex items-stretch px-6 sm:px-10 lg:px-0 min-h-[16rem]">
          <div className="relative w-full h-full lg:min-h-[36rem]">
            <img
              src={heroImg400}
              srcSet={heroSrcSet}
              sizes="(max-width: 1023px) 100vw, 50vw"
              alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
              className="absolute inset-0 w-full h-full object-cover rounded-2xl lg:rounded-none lg:rounded-l-[2rem] shadow-2xl ring-1 ring-border/30"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              width={1000}
              height={1000}
            />
            {/* Subtle left-edge fade so image meets text section softly */}
            <div
              aria-hidden
              className="hidden lg:block absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background/40 to-transparent lg:rounded-l-[2rem] pointer-events-none"
            />

            {/* Floating live-job card */}
            {liveJobs[0] && (
              <div className="hidden sm:flex absolute bottom-6 left-6 lg:left-10 items-center gap-2.5 p-3 pr-4 rounded-xl bg-card/95 backdrop-blur border border-border shadow-xl animate-fade-in [animation-delay:600ms] opacity-0 max-w-[15rem]">
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

    </section>
  );
};

export default HeroSection;
