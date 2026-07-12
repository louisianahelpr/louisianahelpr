import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Search } from "lucide-react";
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
    <section className="relative overflow-hidden hero-mesh-bg flex flex-col justify-center items-center min-h-[calc(100svh-22rem)] px-5 sm:px-8 lg:px-12 pt-16 sm:pt-20 lg:pt-24 pb-6 sm:pb-8 lg:pb-10">
<div className="relative z-10 w-full mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid md:grid-cols-[1.6fr_1fr] items-center gap-10 md:gap-12 lg:gap-16 text-center">
        {/* H1 in a frosted-glass card — STRONGER treatment than the right
            column so the title catches the eye first. Deeper white fill,
            heavier drop shadow, larger padding. */}
        <div
          className="relative rounded-3xl px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-16 backdrop-blur-sm"
          style={{
            background:
              "linear-gradient(135deg, hsl(0 0% 100% / 0.85) 0%, hsl(38 25% 96% / 0.75) 100%)",
            border: "1px solid hsl(var(--olivewood) / 0.18)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.7), 0 1px 3px hsl(var(--olivewood) / 0.10), 0 30px 60px -20px hsl(var(--olivewood) / 0.22)",
          }}
        >
          <h1
            ref={headlineRef}
            className="relative font-display font-black leading-[1.02] text-balance break-words text-[3.25rem] sm:text-6xl md:text-[4rem] lg:text-[6rem] xl:text-[8rem] hero-h1-settle"
            style={{
              color: "hsl(var(--olivewood))",
              letterSpacing: "-0.025em",
            }}
          >
            Louisiana&rsquo;s Local Job{" "}
            <span className="relative inline-block">
              <em
                className="relative"
                style={{
                  fontStyle: "italic",
                  color: "hsl(var(--burnt-sienna))",
                }}
              >
                Partner.
              </em>
            </span>
          </h1>
        </div>

        {/* Right column — subtle glass card (weaker than the H1's card
            above) so the title catches the eye first and the right block
            reads as a supporting focal object. Lighter fill, softer border,
            no drop shadow — just an inset highlight. */}
        <div
          className="flex flex-col gap-6 lg:gap-8 items-center text-center rounded-2xl px-6 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10"
          style={{
            background: "hsl(0 0% 100% / 0.35)",
            border: "1px solid hsl(var(--olivewood) / 0.08)",
            boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          {/* Tagline "Made in Louisiana" removed per user request. */}
          <p
            className="max-w-sm mx-auto text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed text-balance"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 400,
              letterSpacing: "-0.005em",
              color: "hsl(var(--stormy-sky))",
            }}
          >
            Hire a Helpr or find local work. Whether you need a hand or
            you&rsquo;re ready to lend one, we&rsquo;re your trusted local
            partner for everyday jobs.
          </p>

          {/* Proof strip removed per user request. */}

          {/* Stacked CTAs — always vertical, sit right under the subhead */}
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <Button
              asChild
              size="xl"
              className="btn-grad-primary group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-full tracking-tight w-full transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
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
              className="group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-full tracking-tight w-full transition-all duration-200 hover:-translate-y-0.5"
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
                Browse Jobs
                <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Scroll hint was moved OUT of the hero and placed below the jobs
          strip in Index.tsx per user preference (chevron should sit under
          the marquee, not on top of it). */}

    </section>
  );
};

export default HeroSection;
