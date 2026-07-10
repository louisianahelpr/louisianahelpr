import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Search, ShieldCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import CategoryBento from "@/components/landing/CategoryBento";
import { useCountUp } from "@/hooks/useCountUp";

/**
 * Hero — Louisiana Helpr 2026 brand system.
 *
 * Single centered editorial composition: eyebrow + Bodoni Moda H1 +
 * EB Garamond italic subhead + two action buttons + a trust/local-proof
 * strip, all stacked in one flow column that is centered in the section
 * and fits every viewport (no absolutely-positioned art to overflow at
 * half-screen). The category rail anchors the bottom of the hero.
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  // Real "active now" count of open jobs from the last 7 days. Pulled
  // via the public get_marketplace_activity_count RPC. Null until the
  // first call returns; stays null on error so the proof line falls back
  // to honest copy without flashing a fake "0" or zero state.
  const [activeCount, setActiveCount] = useState<number | null>(null);
  // Tween between successive counts so the number animates instead of
  // snapping. Respects prefers-reduced-motion (snaps instantly there).
  const animatedCount = useCountUp(activeCount, { durationMs: 1200 });
  const headlineRef = useRef<HTMLHeadingElement>(null);

  // Variable kerning on scroll — the H1 letter-spacing tightens slightly as
  // the user scrolls past the hero. Restrained: clamps at -0.06 em max.
  // Skipped for users who prefer reduced motion.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;

    let raf = 0;
    const update = () => {
      const el = headlineRef.current;
      if (!el) return;
      const scroll = Math.min(window.scrollY, 600);
      const tighten = (scroll / 600) * 0.035; // 0 -> 0.035 em over 600 px
      el.style.letterSpacing = `${-0.025 - tighten}em`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Fetch the real "active now" count after first interaction so the
  // initial paint stays static and the supabase chunk doesn't block LCP.
  // Failures stay quiet — proof line falls back to "Live in Louisiana".
  useEffect(() => {
    let cancelled = false;
    const kick = async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data, error } = await supabase.rpc("get_marketplace_activity_count");
        if (cancelled || error) return;
        if (typeof data === "number" && data > 0) setActiveCount(data);
      } catch {
        /* keep activeCount null → proof line stays generic */
      }
    };
    const timer = window.setTimeout(kick, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Defer auth check until after first interaction (or 25 s) so the supabase
  // chunk doesn't block LCP. CTA handlers re-fetch session inline, so this
  // only changes optimistic logged-in routing for the first click.
  useEffect(() => {
    let kicked = false;
    const kick = () => {
      if (kicked) return;
      kicked = true;
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
      void (async () => {
        const { supabase } = await import("@/integrations/supabase/client");
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) setLoggedIn(true);
      })();
    };
    window.addEventListener("pointerdown", kick, { once: true, passive: true });
    window.addEventListener("keydown", kick, { once: true, passive: true });
    window.addEventListener("touchstart", kick, { once: true, passive: true });
    const fallback = window.setTimeout(kick, 25000);

    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      window.removeEventListener("touchstart", kick);
      if (fallback) window.clearTimeout(fallback);
    };
  }, []);

  // CTAs render as real <Link>s (crawlable href = the anonymous-visitor
  // destination). The onClick intercepts client-side so logged-in users get
  // auth-aware routing instead, while crawlers/JS-disabled visitors still
  // follow the static href.
  const goToPostJob = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (loggedIn) {
      navigate("/post-job");
      return;
    }
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  // Anonymous visitors get the public job feed (/browse) so they can taste
  // the marketplace before signing up. Logged-in users go to their
  // dashboard, where the same feed lives but with personalized rails.
  const goToJoinCommunity = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loggedIn) {
      navigate("/dashboard");
      return;
    }
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/dashboard" : "/browse");
  };

  return (
    <section className="relative min-h-[100svh] flex flex-col px-5 sm:px-8 lg:px-12 pt-20 sm:pt-20 lg:pt-24 pb-5">
      {/* Hero content — a single flow column centered in the section. No
          absolutely-positioned art means the composition can never overflow
          or clip at half-screen widths. */}
      <div className="flex-1 flex flex-col justify-center items-center text-center">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center">

          {/* Live status pill — real count of currently-open jobs (last 7
              days) when activity exists, "Live in Louisiana" otherwise so we
              never flash a deflating "0 jobs". Leads the hero as the first
              proof-of-life signal. */}
          <span
            className="status-pill-glow inline-flex items-center gap-2 px-3.5 py-2 rounded-full font-mono font-medium"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.5)",
              color: "hsl(var(--ink-deep))",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              backdropFilter: "blur(12px) saturate(170%)",
              WebkitBackdropFilter: "blur(12px) saturate(170%)",
              fontSize: "0.65rem",
              letterSpacing: "0.01em",
            }}
          >
            {/* Burnt-sienna (not the green --live token) so the dot + glow
                match the brand's "Live" heartbeat, not a clashing green. */}
            <span
              className="w-1.5 h-1.5 rounded-full motion-safe:animate-pulse"
              style={{
                backgroundColor: "hsl(var(--burnt-sienna))",
                boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.6)",
              }}
            />
            {animatedCount !== null
              ? `${animatedCount} ${animatedCount === 1 ? "job" : "jobs"} open now`
              : "Live in Louisiana"}
          </span>

          <span className="text-display-eyebrow mt-6">Made in Louisiana</span>

          {/* H1 — Bodoni Moda 900, italic Burnt-Sienna emphasis on "Partner."
              Letter-spacing animates on scroll. `text-balance` keeps the two
              lines even; `break-words` guards the long unbreakable word
              "Louisiana's" from bursting a ~320px viewport. */}
          <h1
            ref={headlineRef}
            className="font-display font-black leading-[1.02] text-balance break-words mt-4 text-[2.5rem] sm:text-6xl lg:text-7xl xl:text-[5rem] max-w-4xl"
            style={{ color: "hsl(var(--olivewood))", letterSpacing: "-0.025em" }}
          >
            Louisiana&rsquo;s Local Job{" "}
            <em
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              Partner.
            </em>
          </h1>

          {/* Subhead — open-air leading, both-sides marketplace explanation */}
          <p
            className="font-serif italic mt-6 sm:mt-7 max-w-2xl text-ds-17 sm:text-ds-20 lg:text-ds-24 leading-relaxed text-balance"
            style={{
              color: "hsl(var(--stormy-sky))",
              fontWeight: 600,
              textShadow: "0 1px 1px rgba(46, 47, 34, 0.06)",
            }}
          >
            Hire a Helpr or find local work. Whether you need a hand or
            you&rsquo;re ready to lend one, we&rsquo;re your trusted Louisiana
            partner for everyday jobs.
          </p>

          {/* CTAs — side by side on desktop, stacked full-width on mobile. */}
          <div className="mt-9 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full max-w-sm sm:max-w-none">
            <Button
              asChild
              size="xl"
              className="btn-grad-primary group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-2xl tracking-tight w-full sm:w-auto sm:min-w-[13.5rem] transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
              style={{
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                fontSize: "1rem",
                lineHeight: 1,
                letterSpacing: "-0.005em",
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(66 25% 19%)",
                boxShadow:
                  "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 12px 32px -8px hsl(var(--bark) / 0.35)",
              }}
            >
              <Link to="/signup" onClick={goToPostJob}>
                <Sparkles className="mr-2 w-5 h-5" strokeWidth={1.25} />
                Post a job
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
              </Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="outline"
              className="group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-2xl tracking-tight w-full sm:w-auto sm:min-w-[13.5rem] transition-all duration-200 hover:-translate-y-0.5"
              style={{
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                fontSize: "1rem",
                lineHeight: 1,
                letterSpacing: "-0.005em",
                color: "hsl(var(--bark))",
                background: "rgba(255, 255, 255, 0.45)",
                backgroundImage: "none",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1.5px solid hsl(var(--bark) / 0.4)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -8px rgba(46,47,34,0.08)",
              }}
            >
              <Link to="/browse" onClick={goToJoinCommunity}>
                <Search className="mr-2 w-5 h-5" strokeWidth={1.25} />
                Browse Local Jobs
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
              </Link>
            </Button>
          </div>

          {/* Trust + local-proof strip — the three signals that make it safe
              to hire (and worth showing up to work): real local activity,
              ID-verified people, statewide coverage. Honest: the count line
              mirrors the live pill; the other two are standing platform
              facts. */}
          <div
            className="mt-8 sm:mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-ds-12 sm:text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: "hsl(var(--burnt-sienna))" }}
              />
              {animatedCount !== null
                ? `${animatedCount} job${animatedCount === 1 ? "" : "s"} open right now`
                : "Real jobs posted daily"}
            </span>
            <span aria-hidden style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.75} style={{ color: "hsl(var(--sage))" }} />
              ID-verified neighbors
            </span>
            <span aria-hidden style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
              Serving all of Louisiana
            </span>
          </div>
        </div>
      </div>

      {/* ── Category bar ──────────────────────────────────────────────
          Anchored below the hero copy as a full-bleed browse-affordance
          rail (negative margins cancel the section padding so it spans
          edge-to-edge). A hairline top divider separates it from the hero. */}
      <div
        className="-mx-5 sm:-mx-8 lg:-mx-12 px-5 sm:px-8 lg:px-12 pt-6 sm:pt-8 mt-8 sm:mt-10"
        style={{ borderTop: "1px solid hsl(46 20% 30% / 0.08)" }}
      >
        <CategoryBento onSelect={goToPostJob} />
      </div>
    </section>
  );
};

export default HeroSection;
