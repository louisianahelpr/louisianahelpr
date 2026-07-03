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
    <section className="relative min-h-[100svh] flex flex-col px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-20 sm:pt-20 lg:pt-24 pb-5">
      {/* Status light — proof-of-life pill anchored to the top-right of the
          entire hero section. Pulsing glow halo (status-pill-glow) reads
          as a "live" heartbeat for the whole platform. */}
      <span
        className="status-pill-glow absolute top-14 sm:top-16 lg:top-20 right-5 sm:right-8 lg:right-12 inline-flex items-center gap-2 px-3.5 py-2 rounded-full font-mono font-medium z-10"
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
        {/* Burnt-sienna (not the green --live token) so the pill's dot +
            glow match the brand's "Live" heartbeat and don't read as a
            clashing green glow. */}
        <span
          className="w-1.5 h-1.5 rounded-full motion-safe:animate-pulse"
          style={{
            backgroundColor: "hsl(var(--burnt-sienna))",
            boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.6)",
          }}
        />
        {animatedCount !== null
          ? `${animatedCount} ${animatedCount === 1 ? "job" : "jobs"} open`
          : "Live in Louisiana"}
      </span>

      {/* Hero content — centered in the section. */}
      <div className="flex-1 flex flex-col justify-center pt-8 sm:pt-10 lg:pt-12">
      <div
        className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] relative"
        style={{ zIndex: 1 }}
      >
        {/* Asymmetric 60/40 hero — branding on the left, phone cluster on
            the right. items-center vertically centers the phones against
            the taller left column so they sit in the middle of the row.
            Container is capped at max-w-7xl (not full-bleed) and the gap is
            kept moderate so the two halves sit a comfortable distance apart
            on wide screens — a wider container + larger gap pooled all the
            unused track-space into a dead void down the page center.
            The split only engages at lg (1024px); below that the 60/40
            columns don't have room and crush both halves toward the
            center, so we stack instead (the mobile composition). */}
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">

          {/* LEFT 60% — branding only. Buttons moved below the marquee.
              `min-w-0` overrides the CSS-grid default of `min-width: auto`,
              which otherwise lets the column expand to the H1's min-content
              size (Bodoni Moda renders "Louisiana's" at ~280px at the 2.25rem
              <sm step). Without it the grid item — and every child of it
              (h1, subhead, CTAs) — bursts 8px past the 320 px viewport even
              though the section has `px-5`. */}
          <div className="lg:col-span-7 min-w-0">
            <span className="text-display-eyebrow">Made in Louisiana</span>

            {/* H1 — Bodoni Moda 900, italic Burnt-Sienna emphasis on "Partner."
                Letter-spacing animates on scroll. `break-words` + a smaller
                step at the 320-class viewport prevent the long unbreakable
                word "Louisiana's" from pushing past the right edge on a
                320 px iPhone-SE-1 — the pre-fix value (2.75 rem) measured a
                line-box width of ~308 px against a 280 px content column. */}
            <h1
              ref={headlineRef}
              className="font-display font-black leading-[1.0] text-balance break-words mt-5 sm:mt-6 text-[2.25rem] sm:text-5xl lg:text-6xl xl:text-7xl"
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
              className="font-serif italic mt-7 sm:mt-9 max-w-2xl text-ds-17 sm:text-ds-20 lg:text-ds-24 leading-relaxed text-balance"
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

            {/* CTAs — stacked vertically directly under the subhead. */}
            <div className="mt-10 sm:mt-12 flex flex-col gap-3.5 max-w-sm">
              <Button
                asChild
                size="xl"
                className="btn-grad-primary group h-14 sm:h-[3.75rem] lg:h-16 px-7 rounded-2xl tracking-tight w-full transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
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

          {/* RIGHT 40% — fanned cluster of 3 phone mockups. `min-w-0` for the
              same reason as the LEFT column — the inner `PhoneCluster` has
              fixed-width phone children whose min-content would otherwise
              stretch this grid track past the container. */}
          <div className="lg:col-span-5 lg:mt-4 min-w-0 flex flex-col items-center justify-center" aria-hidden="true">
            <PhoneCluster />
          </div>

        </div>
      </div>
      </div>

      {/* ── Category bar ──────────────────────────────────────────────
          Anchored below the hero copy as a full-bleed browse-affordance
          rail (negative margins cancel the section padding so it spans
          edge-to-edge). A hairline top divider separates it from the hero.
          `pr` clearance on desktop keeps the scrolling pills from running
          under the status pill. */}
      <div
        className="-mx-5 sm:-mx-8 lg:-mx-12 xl:-mx-16 2xl:-mx-24 px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-6 sm:pt-8 mt-8 sm:mt-10 lg:pr-44"
        style={{ borderTop: "1px solid hsl(46 20% 30% / 0.08)" }}
      >
        <CategoryBento onSelect={goToPostJob} />
      </div>
    </section>
  );
};

export default HeroSection;
