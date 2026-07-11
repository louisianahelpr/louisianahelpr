import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

/**
 * Hero — Louisiana Helpr 2026 brand system.
 *
 * Single centered editorial composition: eyebrow + Bodoni Moda H1 +
 * EB Garamond italic subhead + a search-input-style primary CTA, all
 * stacked in one flow column that is centered in the section and fits
 * every viewport (no absolutely-positioned art to overflow at half-screen).
 *
 * Typography and color are unchanged from the prior editorial hero — only
 * the CTA row swapped from two side-by-side buttons to a single
 * search-input-style field with a "Popular:" quick-start row beneath it.
 * Both the input submit and the category taps route through the same
 * auth-aware handler that the previous Post-a-job button used: authed users
 * land on /post-job, anonymous users get /signup.
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

  // Auth-aware routing for the search-input submit and every quick-start
  // category link. Authed users go to /post-job (posting flow), anonymous
  // visitors get /signup (so they can enter the marketplace before posting).
  const goToPostJob = async (e?: React.SyntheticEvent) => {
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

  // Popular categories — mirrors what top marketplace heroes surface below
  // their search input. Kept short (5) so the row never wraps on mobile.
  const popularCategories = [
    "Yard work",
    "Cleaning",
    "Moving",
    "Errands",
    "Handyman",
  ];

  return (
    <section className="relative flex flex-col px-5 sm:px-8 lg:px-12 pt-4 sm:pt-8 lg:pt-12 pb-16 sm:pb-24 lg:pb-32">
      {/* Hero content — the category rail now lives ABOVE the hero (in
          Index.tsx, under the fixed nav), so this section no longer needs
          `min-h-[100svh]` + `justify-center`: on mobile that combo left a
          huge blank gap between the category strip and the H1 while the
          section stretched the copy to the vertical center of the viewport.
          Flowing naturally means the H1 sits directly under the categories
          with the CTAs immediately below — no dead space. */}
      <div className="relative flex flex-col items-center text-center">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center">

          {/* The live-count proof lives once, in the trust strip below — the
              old "Live now" pill duplicated it and read as awkward on load
              (it flashed the generic "Live now" fallback before the count
              resolved), so the eyebrow now leads the hero. */}
          <span className="text-display-eyebrow">Made in Louisiana</span>

          {/* H1 — Bodoni Moda 900, italic Burnt-Sienna emphasis on the
              second line's noun. Letter-spacing animates on scroll.
              `text-balance` keeps the two lines even; `break-words` guards
              the unbreakable word "Louisiana" from bursting a ~320 px
              viewport. The second line flips to `sm:block` so at tablet+
              "Louisiana jobs." always claims its own second line — an
              intentional 2-line composition instead of an orphaned "jobs."
              dangling by itself. Mobile keeps the natural inline flow. */}
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

          {/* Subhead — EB Garamond italic, three-beat cadence that mirrors
              the actual arc of using the app. The marketplace mechanics
              live in the sections below, so the hero leads with rhythm and
              promise. Typography intentionally unchanged from the prior
              editorial hero. */}
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

          {/* Search-style CTA — the modern marketplace pattern. Full-width
              pill, embedded submit button on the right. Wired to the same
              auth-aware handler the prior Post-a-job button used. */}
          <form
            onSubmit={goToPostJob}
            className="mt-10 sm:mt-12 w-full max-w-xl"
            role="search"
            aria-label="What do you need done?"
          >
            <div
              className="relative flex items-center h-14 sm:h-16 rounded-full bg-white pl-5 pr-1.5 sm:pl-6 sm:pr-2"
              style={{
                border: "1px solid hsl(var(--bark) / 0.18)",
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -12px hsl(var(--bark) / 0.22)",
              }}
            >
              <Search
                className="w-5 h-5 shrink-0"
                strokeWidth={1.75}
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                aria-hidden="true"
              />
              <input
                type="text"
                readOnly
                onFocus={goToPostJob}
                onClick={goToPostJob}
                placeholder="What do you need done?"
                aria-label="What do you need done?"
                className="flex-1 min-w-0 bg-transparent outline-none border-0 ml-3 sm:ml-4 text-ds-15 sm:text-ds-17 font-sans font-medium placeholder:font-medium placeholder:text-[hsl(var(--olivewood)/0.55)]"
                style={{
                  color: "hsl(var(--olivewood))",
                  cursor: "pointer",
                }}
              />
              <button
                type="submit"
                className="shrink-0 h-11 sm:h-12 px-5 sm:px-7 rounded-full font-sans font-semibold text-ds-14 sm:text-ds-15 transition-[transform,filter] duration-200 hover:brightness-110 active:scale-[0.98]"
                style={{
                  background: "hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  letterSpacing: "-0.005em",
                  boxShadow:
                    "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                Search
              </button>
            </div>
          </form>

          {/* Quick-start category strip — the "Popular: X · Y · Z" row that
              lives below the search input on every top marketplace hero.
              Each category taps into the same auth-aware post-job handler. */}
          <div
            className="mt-4 sm:mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-ds-11 sm:text-ds-13 font-sans"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            <span className="font-medium">Popular:</span>
            {popularCategories.map((cat, i) => (
              <span key={cat} className="flex items-center gap-x-2">
                <button
                  type="button"
                  onClick={goToPostJob}
                  className="font-medium underline-offset-4 hover:underline hover:text-[hsl(var(--burnt-sienna))] transition-colors"
                >
                  {cat}
                </button>
                {i < popularCategories.length - 1 && (
                  <span aria-hidden="true">·</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

    </section>
  );
};

export default HeroSection;
