import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import HelprMark from "@/components/HelprMark";
import { goSignedInOr } from "./goSignedInOr";

/**
 * Hero — Louisiana Helpr 2026 brand system.
 *
 * Single centered editorial composition: eyebrow + Bodoni Moda H1 +
 * Montserrat subhead + two action buttons, all stacked in one flow
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

  // NO variable kerning on scroll. An effect here used to tighten the H1's
  // letter-spacing from -0.025em to -0.06em as you scrolled the first 600px.
  // On a display headline sitting exactly at its wrap point that is not a
  // decorative flourish, it is a relayout: measured at 668px, the headline went
  // from 212px tall on three lines to 141px on two, so scrolling re-wrapped the
  // hero and shifted everything under it by 71px. Tracking is also a layout
  // property, so it was doing that work on every animation frame.
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

  // The CTA renders as a real <Link> (crawlable href = the anonymous-visitor
  // destination). The onClick intercepts client-side so a signed-in visitor
  // lands on Home instead of the sign-up form.
  const goToAccount = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (loggedIn) {
      navigate("/home");
      return;
    }
    await goSignedInOr(navigate, "/home", "/signup");
  };

  return (
    <section className="relative overflow-hidden min-h-lvh flex flex-col justify-center items-center px-5 sm:px-8 lg:px-12 pt-28 sm:pt-32 lg:pt-20 pb-3 sm:pb-4 lg:pb-6">
      {/* Editorial poster: ONE centered column. No boxes. The parchment
          is the paper; the type is the show. Confidence over complexity. */}
      <div className="relative z-10 w-full mx-auto max-w-5xl flex flex-col items-center text-center gap-10 sm:gap-14 lg:gap-16">
        {/* Warm ambient halo behind the title — subtle gold light source
            on the parchment. No box, no border. */}
        {/* Wordmark above the headline (owner). The top nav now carries the
            crest alone, so this is where the brand actually says its name on
            the landing page. It sits ABOVE the h1 and does not touch it — the
            hero headline's font, colour and copy are locked. `to={null}`
            because a link back to "/" from the top of "/" is a no-op. */}
        <div className="relative z-10 -mb-6 sm:-mb-8 lg:-mb-10">
          <HelprMark to={null} size="md" hideEmblem />
        </div>

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
            // Strictly increasing: 56 → 72 → 88 → 96 → 116px. It used to run
            // 56 → 80 → 104 → 96 → 116, i.e. `md` was BIGGER than `lg`, so the
            // 768–1023px band rendered the hero larger than a full desktop
            // does — 12.4vw there against 9.4vw at `lg` and 9.1vw at `xl`. On a
            // ~840px window (a half-screen browser, a small laptop, an iPad
            // landscape) the headline swelled ~30% out of proportion and then
            // visibly SHRANK as you widened past 1024. Only `sm` and `md` moved;
            // `lg`/`xl` — the sizes on a normal desktop — are untouched.
            className="landing-h1 relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[3.5rem] sm:text-[4.5rem] md:text-[5.5rem] lg:text-[6rem] xl:text-[7.25rem]"
            style={{
              color: "hsl(var(--olivewood))",
              letterSpacing: "-0.03em",
            }}
          >
            Louisiana&rsquo;s Local{" "}
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
          Jobs, Declutter, Shops and Homes: everything local, in one place.
        </p>

        {/* ONE obvious sign-up action (owner, 2026-10-19: the landing is the
            front door for all four sections, so the CTA is the account, not
            one section's form), with Browse as a quiet text link beside it. */}
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-7">
          <Button
            asChild
            size="xl"
            className="btn-grad-primary group h-16 sm:h-[4.25rem] lg:h-[5rem] w-full sm:w-auto sm:min-w-[19rem] px-12 lg:px-14 rounded-full tracking-tight text-ds-17"
            style={{ fontFamily: "Montserrat, system-ui, sans-serif", fontWeight: 600, lineHeight: 1, color: "hsl(var(--parchment))" }}
          >
            <Link to="/signup" onClick={goToAccount} data-testid="landing-signup">
              Join Helpr free
              <ArrowRight className="ml-2.5 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.5} />
            </Link>
          </Button>
          {/* The feed this visitor can use: the guest board, or Jobs > Browse once signed in. */}
          <Link
            to={loggedIn ? "/jobs" : "/browse"}
            className="group inline-flex items-center gap-1.5 text-ds-17 font-semibold text-[hsl(var(--bark))] underline-offset-4 hover:underline"
          >
            <Search className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden />
            Browse local jobs
          </Link>
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
          className="w-5 h-5 motion-safe:animate-bounce"
          strokeWidth={1.75}
          style={{ color: "hsl(var(--olivewood) / 0.55)" }}
        />
      </div>
    </section>
  );
};

export default HeroSection;
