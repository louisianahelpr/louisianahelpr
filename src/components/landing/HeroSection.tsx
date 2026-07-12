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
    <section className="relative overflow-hidden flex flex-col justify-center items-center min-h-[calc(100svh-19rem)] px-5 sm:px-8 lg:px-12 pt-14 sm:pt-16 lg:pt-20 pb-3 sm:pb-4 lg:pb-6">
      {/* Editorial poster: ONE centered column. No boxes. The parchment
          is the paper; the type is the show. Confidence over complexity. */}
      <div className="relative z-10 w-full mx-auto max-w-5xl flex flex-col items-center text-center gap-8 sm:gap-10 lg:gap-12">
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
            className="relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[3.5rem] sm:text-[5rem] md:text-[6.5rem] lg:text-[8rem] xl:text-[10rem] hero-h1-settle"
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

        {/* Subhead — tight, editorial, quiet. Sits directly on parchment. */}
        <p
          className="max-w-xl text-ds-15 sm:text-ds-17 lg:text-ds-20 leading-relaxed text-balance"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "hsl(var(--stormy-sky))",
          }}
        >
          Hire a Helpr or find local work. Trusted neighbors, escrow-protected,
          across Louisiana.
        </p>

        {/* One primary CTA — bark fill, oversized pill. Browse Jobs is
            demoted to a text link beneath so the fold has ONE conversion
            choice, not two competing ones. */}
        <div className="flex flex-col items-center gap-4">
          <Button
            asChild
            size="xl"
            className="btn-grad-primary group h-16 sm:h-[4.25rem] px-12 rounded-full tracking-tight transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
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
          <Link
            to="/browse"
            onClick={goToJoinCommunity}
            className="group inline-flex items-center gap-1.5 text-ds-13 font-sans font-medium underline underline-offset-4 decoration-[hsl(var(--olivewood)/0.3)] hover:decoration-[hsl(var(--heritage-gold))] transition-colors"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
            Or browse open jobs
            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.5} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
