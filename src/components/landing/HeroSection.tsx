import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import CategoryBento from "@/components/landing/CategoryBento";
import PhoneCluster from "@/components/landing/PhoneCluster";
import { useCountUp } from "@/hooks/useCountUp";

/**
 * Hero — Louisiana Helpr 2026 brand system.
 *
 * Single-viewport composition: eyebrow + handwritten signature + Bodoni
 * Moda H1 + EB Garamond italic subhead + two Beth Ellen action buttons
 * are vertically centered to fit one full screen (min-h-screen + flex).
 * No stat strip — the hero stays focused on the brand statement.
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  // Real "active now" count of open jobs from the last 7 days. Pulled
  // via the public get_marketplace_activity_count RPC. Null until the
  // first call returns; stays null on error so the pill falls back to
  // honest copy without flashing a fake "0" or zero state.
  const [activeCount, setActiveCount] = useState<number | null>(null);
  // Tween between successive counts so the number animates instead of
  // snapping. Respects prefers-reduced-motion (snaps instantly there).
  const animatedCount = useCountUp(activeCount, { durationMs: 1200 });
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const meshRef = useRef<HTMLDivElement>(null);

  // Pause the mesh-gradient drift animation when the tab is hidden.
  // The CSS animation otherwise keeps requesting composite cycles even
  // when no one is looking — wasted work on lower-end devices.
  // The `.is-paused` class sets `animation-play-state: paused`.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = meshRef.current;
    if (!el) return;
    const sync = () => {
      el.classList.toggle("is-paused", document.visibilityState !== "visible");
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
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

  // Fetch the real "active now" count after first interaction so the
  // initial paint stays static and the supabase chunk doesn't block LCP.
  // Failures stay quiet — pill falls back to "Live in Louisiana".
  useEffect(() => {
    let cancelled = false;
    const kick = async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data, error } = await supabase.rpc("get_marketplace_activity_count");
        if (cancelled || error) return;
        if (typeof data === "number" && data > 0) setActiveCount(data);
      } catch {
        /* keep activeCount null → pill stays generic */
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
    <section className="relative min-h-[90vh] px-5 sm:px-8 lg:px-12 pt-32 sm:pt-40 lg:pt-48 pb-16">
      {/* Status light — proof-of-life pill anchored to the top-right of the
          entire hero section. Pulsing glow halo (status-pill-glow) reads
          as a "live" heartbeat for the whole platform. */}
      <span
        className="status-pill-glow absolute top-20 sm:top-24 lg:top-28 right-5 sm:right-8 lg:right-12 inline-flex items-center gap-2 px-3.5 py-2 rounded-full font-mono font-medium z-10"
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
        {/* Status pill — shows real count of currently-open jobs from
            the last 7 days when activity exists, falls back to "Live in
            Louisiana" otherwise (so we never flash a deflating "0 jobs
            open"). Count is fetched lazily via public RPC after first
            paint to keep LCP fast. */}
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{
            backgroundColor: "hsl(120, 60%, 50%)",
            boxShadow: "0 0 6px hsl(120, 60%, 55%, 0.6)",
          }}
        />
        {animatedCount !== null
          ? `${animatedCount} ${animatedCount === 1 ? "job" : "jobs"} open`
          : "Live in Louisiana"}
      </span>
      {/* Mesh gradient — five drifting radial washes (cream + sage + sienna)
          that animate slowly, giving the "liquid" page mood without
          distracting from content. Pointer-events disabled so it never
          blocks clicks. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div ref={meshRef} className="mesh-gradient" />
      </div>

      <div
        className="container mx-auto max-w-6xl relative w-full"
        style={{ zIndex: 1 }}
      >
        {/* Asymmetric 60/40 hero — branding on the left, phone cluster on
            the right. items-center vertically centers the phones against
            the taller left column so they sit in the middle of the row. */}
        <div className="grid md:grid-cols-12 gap-10 md:gap-12 lg:gap-16 items-center">

          {/* LEFT 60% — branding only. Buttons moved below the marquee.
              `min-w-0` overrides the CSS-grid default of `min-width: auto`,
              which otherwise lets the column expand to the H1's min-content
              size (Bodoni Moda renders "Louisiana's" at ~280px at the 2.25rem
              <sm step). Without it the grid item — and every child of it
              (h1, subhead, CTAs) — bursts 8px past the 320 px viewport even
              though the section has `px-5`. */}
          <div className="md:col-span-7 min-w-0">
            <span className="text-display-eyebrow">Made in Louisiana</span>

            {/* H1 — Bodoni Moda 900, italic Burnt-Sienna emphasis on "Partner."
                Letter-spacing animates on scroll. `break-words` + a smaller
                step at the 320-class viewport prevent the long unbreakable
                word "Louisiana's" from pushing past the right edge on a
                320 px iPhone-SE-1 — the pre-fix value (2.75 rem) measured a
                line-box width of ~308 px against a 280 px content column. */}
            <h1
              ref={headlineRef}
              className="font-display font-black leading-[1.0] text-balance break-words mt-4 sm:mt-5 text-[2.25rem] sm:text-5xl lg:text-6xl xl:text-7xl"
              style={{ color: "hsl(var(--olivewood))", letterSpacing: "-0.025em" }}
            >
              Louisiana&rsquo;s Local Task{" "}
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
              className="font-serif italic mt-6 sm:mt-7 max-w-xl text-ds-17 sm:text-ds-20 lg:text-ds-24 leading-relaxed text-balance"
              style={{
                color: "hsl(var(--stormy-sky))",
                fontWeight: 600,
                textShadow: "0 1px 1px rgba(46, 47, 34, 0.06)",
              }}
            >
              Hire a Helpr or find local work. Whether you need a hand or
              you&rsquo;re ready to lend one, we&rsquo;re your trusted Louisiana
              partner for everyday tasks.
            </p>

            {/* CTAs — stacked vertically directly under the subhead. */}
            <div className="mt-8 sm:mt-10 flex flex-col gap-3 max-w-sm">
              <Button
                asChild
                size="xl"
                className="btn-liquid-fill group h-14 sm:h-[3.75rem] lg:h-16 px-7 rounded-2xl tracking-tight w-full"
                style={{
                  fontFamily: "Montserrat, system-ui, sans-serif",
                  fontWeight: 600,
                  fontSize: "1rem",
                  lineHeight: 1,
                  letterSpacing: "-0.005em",
                  color: "hsl(var(--parchment))",
                  background: "hsl(var(--bark))",
                  backgroundImage: "none",
                  border: "1px solid hsl(var(--bark))",
                  boxShadow:
                    "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -8px rgba(0,0,0,0.1)",
                }}
              >
                <Link to="/signup" onClick={goToPostJob}>
                  <Sparkles className="mr-2 w-5 h-5" strokeWidth={1.25} />
                  Post a Request
                  <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
                </Link>
              </Button>
              <Button
                asChild
                size="xl"
                variant="outline"
                className="group h-14 sm:h-[3.75rem] lg:h-16 px-7 rounded-2xl tracking-tight w-full transition-all duration-200 hover:-translate-y-0.5"
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
          </div>

          {/* RIGHT 40% — fanned cluster of 3 phone mockups + App Store
              badges below. The badges close the "this is an app, where do
              I download it?" loop that the phone mockups open.
              `min-w-0` for the same reason as the LEFT column — the inner
              `PhoneCluster` has fixed-width phone children whose min-content
              would otherwise stretch this grid track past the container. */}
          <div className="md:col-span-5 md:mt-16 lg:mt-20 min-w-0">
            <PhoneCluster />
            {/* App Store badges — `flex-wrap` lets each pill drop onto its
                own row on the tightest viewports (320 px iPhone-SE-1 and
                similar) where two side-by-side badges + container padding
                otherwise total ~330 px and push past the viewport. */}
            <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center md:justify-end gap-3">
              <a
                href="https://apps.apple.com/us/app/helpr/id6754470134"
                target="_blank"
                rel="noopener noreferrer"
                className="liquid-glass inline-flex items-center gap-2 px-3.5 py-2 rounded-ds-md transition-transform duration-200 hover:-translate-y-0.5"
                style={{ color: "hsl(var(--ink-deep))" }}
                aria-label="Download Helpr on the App Store"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <div className="text-left leading-none">
                  <span
                    className="font-mono uppercase block"
                    style={{
                      fontSize: "0.55rem",
                      color: "hsl(var(--stormy-sky))",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Download on the
                  </span>
                  <span
                    className="font-display font-bold tracking-tight block"
                    style={{ fontSize: "0.95rem", marginTop: "1px" }}
                  >
                    App Store
                  </span>
                </div>
              </a>
              <span
                className="liquid-glass inline-flex items-center gap-2 px-3.5 py-2 rounded-ds-md"
                style={{
                  color: "hsl(var(--ink-deep))",
                  opacity: 0.6,
                }}
                aria-label="Coming soon to Google Play"
                title="Coming soon to Google Play"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
                  <path d="M3.6 1.86a1 1 0 00-.6.91v18.46a1 1 0 00.6.91l11.34-10.14L3.6 1.86zm12.84 9.34l2.94 2.62 3.42-1.97c.94-.54.94-1.9 0-2.44l-3.42-1.97-2.94 2.62-.18.07.18.07zm-1.5-.85L4.49 1.21 15.14 11l-.2.34zm0 1.7l.2.34L4.49 22.79l10.45-9.14z"/>
                </svg>
                <div className="text-left leading-none">
                  <span
                    className="font-mono uppercase block"
                    style={{
                      fontSize: "0.55rem",
                      color: "hsl(var(--stormy-sky))",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Coming soon
                  </span>
                  <span
                    className="font-display font-bold tracking-tight block"
                    style={{ fontSize: "0.95rem", marginTop: "1px" }}
                  >
                    Google Play
                  </span>
                </div>
              </span>
            </div>
          </div>

        </div>

        {/* Category marquee — full-width row beneath the asymmetric grid,
            underlining the entire hero block. (City strip moved to a
            separator between Hero and How-It-Works in Index.tsx.) */}
        <div className="mt-16 sm:mt-20 lg:mt-24">
          <CategoryBento onSelect={goToPostJob} />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
