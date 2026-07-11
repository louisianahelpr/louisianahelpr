import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

/**
 * Hero — Louisiana Helpr 2026 brand system, top-marketplace visual language.
 *
 * Modern marketplace pattern (TaskRabbit / Handy / Thumbtack / Airtasker / Angi):
 *   1. Bold modern-sans H1 (Montserrat 900, tight tracking) — not editorial serif.
 *   2. One-line sans subhead — not multi-line italic serif.
 *   3. A prominent SEARCH-STYLE INPUT as the primary CTA — not two side-by-side
 *      buttons. Below it, a compact strip of popular categories as quick-start
 *      taps.
 *
 * Both the input submit and the category taps route through the same
 * auth-aware handler that the previous Post-a-job button used: authed users
 * land on /post-job, anonymous users get /signup.
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  // Variable kerning on scroll — the H1 letter-spacing tightens slightly as
  // the user scrolls past the hero. Restrained: clamps at -0.065 em max
  // (starts at -0.03 em to match the modern-marketplace baseline).
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
      el.style.letterSpacing = `${-0.03 - tighten}em`;
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
      <div className="relative flex flex-col items-center text-center">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center">

          {/* Eyebrow — kept unchanged. Anchors the composition and reads as
              a modern marketplace's "local promise" tag. */}
          <span className="text-display-eyebrow">Made in Louisiana</span>

          {/* H1 — Montserrat 900 (font-sans font-black), tight -0.03em
              tracking. This is the top-marketplace visual pattern: bold
              modern-sans headline, not editorial serif. The italic
              burnt-sienna emphasis stays on the noun ("Partner.") for
              accent-color anchoring, but rendered in italic Montserrat
              instead of italic serif. */}
          <h1
            ref={headlineRef}
            className="font-sans font-black leading-[1.02] text-balance break-words mt-6 sm:mt-8 text-[2.5rem] sm:text-6xl lg:text-7xl xl:text-[5rem] max-w-4xl"
            style={{ color: "hsl(var(--olivewood))", letterSpacing: "-0.03em" }}
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

          {/* Subhead — one line, modern sans medium. Tighter and less
              editorial than the prior three-line italic serif, which is the
              visual language every top marketplace hero uses. */}
          <p
            className="font-sans font-medium mt-6 sm:mt-8 max-w-2xl text-ds-15 sm:text-ds-17 leading-relaxed"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            Louisiana neighbors, ready to help — hire in minutes.
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
