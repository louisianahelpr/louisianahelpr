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
      {/* (7) Louisiana state outline — absolute, bottom-right, 8% opacity.
          A rough boot-shaped path silhouette, in olivewood. Decorative,
          aria-hidden. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute right-2 sm:right-6 bottom-2 sm:bottom-6 hidden md:block w-40 lg:w-56 h-40 lg:h-56"
        style={{ color: "hsl(var(--olivewood))", opacity: 0.08 }}
        fill="currentColor"
      >
        {/* Simplified Louisiana silhouette — flat top, coastal bottom */}
        <path d="M12 12 L74 12 L74 30 L88 30 L88 68 L76 68 L74 78 L62 82 L58 74 L46 78 L42 70 L34 74 L28 66 L20 70 L14 60 L18 46 L14 40 L20 32 L12 24 Z" />
      </svg>

      {/* Narrower max-width + tighter gap so the H1 (left) + right column
          feel like ONE centered composition rather than two blocks spread
          to the viewport edges. */}
      <div className="relative z-10 w-full mx-auto max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl grid md:grid-cols-[1.4fr_1fr] items-center gap-8 md:gap-10 lg:gap-14 text-center">
        {/* (2) H1: "Partner." is italic + burnt-sienna (restored) with a
            hairline gold-warm underline (6) and a soft radial glow (5)
            behind it for anchoring. */}
        <h1
          ref={headlineRef}
          className="font-display font-black leading-[1.02] text-balance break-words text-[3.25rem] sm:text-6xl md:text-[4rem] lg:text-[6rem] xl:text-[8rem] hero-h1-settle"
          style={{ color: "hsl(var(--olivewood))", letterSpacing: "-0.025em" }}
        >
          Louisiana&rsquo;s Local Job{" "}
          <span className="relative inline-block">
            {/* (5) Soft radial glow behind "Partner." — anchors the eye */}
            <span
              aria-hidden="true"
              className="absolute inset-0 -m-8 pointer-events-none"
              style={{
                background:
                  "radial-gradient(closest-side, hsl(var(--burnt-sienna) / 0.14), transparent 70%)",
              }}
            />
            <em
              className="relative"
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              Partner.
              {/* (6) Hairline underline in gold-warm at 0.3 opacity */}
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 h-[2px] pointer-events-none"
                style={{
                  bottom: "-0.08em",
                  background: "hsl(var(--gold-warm) / 0.3)",
                }}
              />
            </em>
          </span>
        </h1>

        {/* Right column — tagline → subhead → CTAs → proof strip. */}
        <div className="flex flex-col gap-6 lg:gap-8 items-center text-center">
          {/* (1) Italic-serif tagline moved ABOVE the subhead per user pref */}
          <p
            className="font-serif italic text-ds-11 sm:text-ds-13 tracking-wide"
            style={{ color: "hsl(var(--olivewood) / 0.55)" }}
          >
            Made in Louisiana
          </p>
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

          {/* (8) Slim proof strip — ONE line, muted. Adds legitimacy
              without the visual weight of a full trust-badge row. */}
          <p
            className="text-ds-11 font-sans"
            style={{ color: "hsl(var(--olivewood) / 0.6)" }}
          >
            <span style={{ color: "hsl(var(--gold-warm))" }} aria-hidden>
              ★
            </span>{" "}
            4.9 · 340 jobs done this week · Held in escrow
          </p>

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
