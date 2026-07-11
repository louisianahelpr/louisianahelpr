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
    <section className="relative flex flex-col px-5 sm:px-8 lg:px-12 pt-14 sm:pt-20 lg:pt-24 pb-16 sm:pb-24 lg:pb-32">
      {/* Hero content — the category rail now lives ABOVE the hero (in
          Index.tsx, under the fixed nav), so this section no longer needs
          `min-h-[100svh]` + `justify-center`: on mobile that combo left a
          huge blank gap between the category strip and the H1 while the
          section stretched the copy to the vertical center of the viewport.
          Flowing naturally means the H1 sits directly under the categories
          with the CTAs immediately below — no dead space. */}
      <div className="flex flex-col items-center text-center">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center">

          {/* The live-count proof lives once, in the trust strip below — the
              old "Live now" pill duplicated it and read as awkward on load
              (it flashed the generic "Live now" fallback before the count
              resolved), so the eyebrow now leads the hero. */}
          <span className="text-display-eyebrow">Made in Louisiana</span>

          {/* H1 — Bodoni Moda 900, italic Burnt-Sienna emphasis on "Partner."
              Letter-spacing animates on scroll. `text-balance` keeps the two
              lines even; `break-words` guards the long unbreakable word
              "Louisiana's" from bursting a ~320px viewport. The inner span
              flips to `sm:block` so at tablet+ "Job Partner." always claims
              its own second line — an intentional 2-line composition instead
              of an orphaned "Partner." dangling by itself. Mobile keeps the
              natural inline flow (font-size scaling already wraps cleanly). */}
          <h1
            ref={headlineRef}
            className="font-display font-black leading-[1.02] text-balance break-words mt-6 sm:mt-8 text-[2.5rem] sm:text-6xl lg:text-7xl xl:text-[5rem] max-w-4xl"
            style={{ color: "hsl(var(--olivewood))", letterSpacing: "-0.025em" }}
          >
            Louisiana&rsquo;s Local{" "}
            <span className="sm:block">
              Job{" "}
              <em
                style={{
                  fontStyle: "italic",
                  color: "hsl(var(--burnt-sienna))",
                }}
              >
                Partner.
              </em>
            </span>
          </h1>

          {/* Subhead — open-air leading, both-sides marketplace explanation */}
          <p
            className="font-serif italic mt-8 sm:mt-10 max-w-2xl text-ds-17 sm:text-ds-20 lg:text-ds-24 leading-relaxed text-balance"
            style={{
              color: "hsl(var(--stormy-sky))",
              fontWeight: 600,
              textShadow: "0 1px 1px rgba(46, 47, 34, 0.06)",
            }}
          >
            Hire a Helpr or find local work. Whether you need a hand or
            you&rsquo;re ready to lend one, we&rsquo;re your trusted local
            partner for everyday jobs.
          </p>

          {/* CTAs — side by side on desktop, stacked full-width on mobile. */}
          <div className="mt-12 sm:mt-14 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full max-w-sm sm:max-w-none">
            <Button
              asChild
              size="xl"
              className="btn-grad-primary group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-full tracking-tight w-full sm:w-auto sm:min-w-[13.5rem] transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
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
              className="group h-14 sm:h-[3.75rem] lg:h-16 px-8 rounded-full tracking-tight w-full sm:w-auto sm:min-w-[13.5rem] transition-all duration-200 hover:-translate-y-0.5"
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
      </div>

    </section>
  );
};

export default HeroSection;
