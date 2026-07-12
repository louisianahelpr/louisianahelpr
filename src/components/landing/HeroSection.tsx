import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Hero — Louisiana Helpr 2026 brand system.
 *
 * Single centered editorial composition: eyebrow + Bodoni Moda H1 +
 * EB Garamond italic subhead + two action buttons, all stacked in one flow
 * column that is centered in the section and fits every viewport (no
 * absolutely-positioned art to overflow at half-screen). The category rail
 * anchors the bottom of the hero.
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  const [scrollHintOpacity, setScrollHintOpacity] = useState(1);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  // Fade the scroll hint out over the first 160 px of scroll — fully
  // visible at rest, fully invisible by the time the user has committed
  // to scrolling. rAF-throttled for smoothness.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const update = () => {
      const y = window.scrollY;
      const next = Math.max(0, 1 - y / 160);
      setScrollHintOpacity(next);
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
    <section className="relative overflow-hidden min-h-svh flex flex-col justify-center items-center px-5 sm:px-8 lg:px-12 pt-28 sm:pt-32 lg:pt-20 pb-3 sm:pb-4 lg:pb-6">
      {/* Editorial poster: ONE centered column. No boxes. The parchment
          is the paper; the type is the show. Confidence over complexity. */}
      <div className="relative z-10 w-full mx-auto max-w-5xl flex flex-col items-center text-center gap-10 sm:gap-14 lg:gap-16">
        {/* Warm ambient halo behind the title — subtle gold light source
            on the parchment. No box, no border. */}
        <div className="relative flex items-center justify-center w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-16 sm:-inset-24 lg:-inset-32 -z-0"
            style={{
              background:
                "radial-gradient(50% 50% at 50% 50%, hsl(var(--gold-warm) / 0.24) 0%, hsl(var(--burnt-sienna) / 0.10) 40%, transparent 75%)",
              filter: "blur(32px)",
            }}
          />
          <h1
            ref={headlineRef}
            className="relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[3.5rem] sm:text-[5rem] md:text-[6.5rem] lg:text-[6rem] xl:text-[7.25rem] hero-h1-settle"
            style={{
              color: "hsl(var(--olivewood))",
              letterSpacing: "-0.03em",
            }}
          >
            Louisiana&rsquo;s Local Job{" "}
            <em
              className="relative inline-block"
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              Partner.
            </em>
          </h1>
        </div>

        {/* Subhead — one flowing line (natural wrap at narrow widths). */}
        <p
          className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-24 leading-relaxed text-balance"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "hsl(var(--stormy-sky))",
          }}
        >
          Hire a Helpr or find local work. For everyday jobs, big and small.
        </p>

        {/* Primary CTA sits horizontally next to a demoted Browse Jobs
            text link so the fold has one clear primary + one quiet
            secondary, side-by-side. Stacks vertically on mobile. */}
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <Button
            asChild
            size="xl"
            className="btn-grad-primary group h-16 sm:h-[4.25rem] lg:h-[5rem] px-12 lg:px-14 rounded-full tracking-tight transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              fontSize: "1.0625rem",
              lineHeight: 1,
              letterSpacing: "-0.005em",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(66 25% 19%)",
              boxShadow:
                "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--bark) / 0.4)",
            }}
          >
            <Link to="/signup" onClick={goToPostJob}>
              <Sparkles className="mr-2.5 w-5 h-5" strokeWidth={1.25} />
              Post a job
              <ArrowRight className="ml-2.5 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
            </Link>
          </Button>
          <Button
            asChild
            size="xl"
            variant="outline"
            className="group h-16 sm:h-[4.25rem] lg:h-[5rem] px-12 lg:px-14 rounded-full tracking-tight transition-all duration-200 hover:-translate-y-0.5"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              fontSize: "1.0625rem",
              lineHeight: 1,
              letterSpacing: "-0.005em",
              color: "hsl(var(--bark))",
              background: "rgba(255, 255, 255, 0.45)",
              backgroundImage: "none",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1.5px solid hsl(var(--bark) / 0.4)",
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -8px rgba(46,47,34,0.08)",
            }}
          >
            <Link to="/browse" onClick={goToJoinCommunity}>
              <Search className="mr-2.5 w-5 h-5" strokeWidth={1.25} />
              Browse Jobs
              <ArrowRight className="ml-2.5 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
            </Link>
          </Button>
        </div>
      </div>

      {/* Scroll hint — bouncing chevron only. Fades to 0 opacity over
          the first 160 px of scroll. */}
      <div
        aria-hidden="true"
        className="absolute bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-150"
        style={{ opacity: scrollHintOpacity }}
      >
        <ChevronDown
          className="w-5 h-5 animate-bounce"
          strokeWidth={1.75}
          style={{ color: "hsl(var(--olivewood) / 0.55)" }}
        />
      </div>
    </section>
  );
};

export default HeroSection;
