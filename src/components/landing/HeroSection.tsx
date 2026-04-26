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
import { getCityState } from "@/lib/locationUtils";
import heroImg400 from "@/assets/hero-porch-garden-400.webp";
import heroImg500 from "@/assets/hero-porch-garden-500.webp";
import heroImg600 from "@/assets/hero-porch-garden-600.webp";
import heroImg1000 from "@/assets/hero-porch-garden-1000.webp";
import heroImg1500 from "@/assets/hero-porch-garden-1500.webp";

// Real responsive set — the browser picks the smallest variant that fits
// display × DPR. We cap at 1500w (~190 KB) instead of 2000w; the previous
// 2000w file was 2 MB and dominated the page-load critical path on retina
// laptops, which is why the hero "loaded after everything else".
const heroSrcSet = `${heroImg400} 400w, ${heroImg500} 500w, ${heroImg600} 600w, ${heroImg1000} 1000w, ${heroImg1500} 1500w`;
const heroSizes = "(max-width: 640px) 360px, (max-width: 1023px) 600px, 1000px";

// NOTE: We intentionally do NOT inject a JS-side <link rel="preload"> here.
// That code only runs after React's bundle parses, which is the very thing
// we'd want to race against — by the time the preload tag exists in the DOM,
// the browser has already discovered the <img> tag itself. The <img>'s
// fetchpriority="high" + loading="eager" + decoding="async" attributes
// achieve the same goal without the dead-code overhead.

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
    // Auth check is cheap and gates UI (CTA label) — keep eager.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setLoggedIn(true);
    });

    // Defer non-critical Supabase queries until after LCP. These power the
    // stats counter and the "live jobs" social-proof row — both render only
    // when data arrives, so deferring them does NOT change the UX (no
    // skeletons swap in/out). This unblocks the longest network chain
    // Lighthouse flagged (HTML → JS → 8 parallel API calls competing with
    // the hero image). requestIdleCallback fires after the browser has
    // painted and processed any urgent work; setTimeout fallback covers
    // Safari which lacks the API.
    const runDeferred = () => {
      Promise.all([
        supabase.rpc("count_profiles"),
        supabase.rpc("get_public_completed_job_count"),
      ]).then(([profilesRes, jobsRes]) => {
        setStats({
          users: typeof profilesRes.data === "number" ? profilesRes.data : 0,
          completed: typeof jobsRes.data === "number" ? jobsRes.data : Number(jobsRes.data) || 0,
        });
      });
      supabase
        .rpc("get_public_open_jobs", { p_limit: 3 })
        .then(({ data }) => {
          if (data) setLiveJobs(data as unknown as LiveJob[]);
        });
    };

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    const handle = w.requestIdleCallback
      ? w.requestIdleCallback(runDeferred, { timeout: 2000 })
      : window.setTimeout(runDeferred, 1500);

    return () => {
      const cancel = (window as Window & {
        cancelIdleCallback?: (h: number) => void;
      }).cancelIdleCallback;
      if (cancel) cancel(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  return (
    <section
      className="relative w-full max-w-full pt-20 sm:pt-24 lg:pt-28 pb-0 flex flex-col min-h-screen min-h-[100dvh] overflow-hidden"
    >
      {/* MAIN: single column on phone & iPad, split-screen on desktop */}
      <div className="flex-1 w-full min-w-0 grid grid-rows-[auto_1fr] lg:grid-rows-1 lg:grid-cols-2 items-stretch pb-4 sm:pb-6 lg:pb-14">
        {/* LEFT: copy + CTAs — vertically centered against image, bottom aligned to image bottom */}
        <div className="min-w-0 max-w-full animate-fade-in px-6 sm:px-10 lg:pl-24 xl:pl-32 lg:pr-8 text-center lg:text-left lg:pt-0 flex flex-col lg:justify-center">
          <div className="w-full max-w-2xl mx-auto lg:mx-0 flex flex-col gap-3 sm:gap-4 lg:gap-8">
            {/* TOP cluster — copy + categories */}
            <div className="flex flex-col gap-3 sm:gap-3 lg:gap-8">
              {/* Eyebrow — Louisiana stamp */}
              <div className="inline-flex max-w-full self-center lg:self-start items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 backdrop-blur border border-primary/20 text-primary text-[10px] sm:text-xs font-bold tracking-wider uppercase shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="truncate">Made in Louisiana, for Louisiana</span>
              </div>

              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl md:text-[3.25rem] lg:text-[4.5rem] xl:text-[5rem] font-display font-bold text-foreground leading-[1.02] tracking-tight text-balance break-words">
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
                <div
                  className="w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide snap-x snap-mandatory"
                  style={{ touchAction: "pan-x" }}
                >
                  <div className="flex min-w-max gap-3 pb-2 pr-8">
                    {categories.map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
                        className="group inline-flex items-center gap-2 px-4 py-2 lg:px-5 lg:py-3 min-h-[44px] rounded-full bg-card/80 backdrop-blur border border-border/60 text-sm lg:text-base font-medium text-foreground shadow-sm hover:border-primary/50 hover:bg-card hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 whitespace-nowrap shrink-0 snap-start"
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
            <div className="flex flex-col sm:flex-row lg:flex-col items-stretch justify-center gap-3 lg:gap-4 w-full max-w-md sm:max-w-2xl lg:max-w-xl mx-auto lg:mx-0">
              <Button
                size="xl"
                className="group w-full h-12 sm:h-13 lg:h-16 px-6 lg:px-8 rounded-xl text-base lg:text-lg font-semibold tracking-tight bg-primary text-primary-foreground shadow-[0_12px_32px_-10px_hsl(var(--primary)/0.55)] hover:bg-primary/95 hover:shadow-[0_16px_40px_-10px_hsl(var(--primary)/0.7)] hover:-translate-y-0.5 transition-all duration-300"
                onClick={() => navigate(loggedIn ? "/post-job" : "/signup")}
              >
                <Sparkles className="mr-2 w-5 h-5" />
                Post a job
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <Button
                variant="outline"
                size="xl"
                className="group w-full h-12 sm:h-13 lg:h-16 px-6 lg:px-8 rounded-xl text-base lg:text-lg font-semibold tracking-tight bg-card border-2 border-primary/40 text-primary shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.35)] hover:bg-primary/5 hover:border-primary hover:shadow-[0_12px_32px_-10px_hsl(var(--primary)/0.5)] hover:-translate-y-0.5 transition-all duration-300"
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
        <div className="relative min-w-0 max-w-full mt-4 sm:mt-6 lg:mt-0 self-stretch flex-1 lg:flex-none flex items-stretch lg:items-center justify-center lg:justify-end px-6 sm:px-10 lg:px-0 min-h-[12rem]">
          <div className="relative w-full h-full lg:h-full lg:min-h-[36rem]">
            <img
              src={heroImg500}
              srcSet={heroSrcSet}
              sizes={heroSizes}
              alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees"
              className="absolute inset-0 w-full h-full object-cover object-[82%_center] sm:object-[82%_center] lg:object-[82%_center] rounded-2xl lg:rounded-none lg:rounded-l-[2rem] shadow-2xl ring-1 ring-border/30"
              loading="eager"
              {...({ fetchpriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>)}
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
                    {getCityState(liveJobs[0].location)}
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
