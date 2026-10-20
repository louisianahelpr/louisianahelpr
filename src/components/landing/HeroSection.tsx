import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CloudSun, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goSignedInOr } from "./goSignedInOr";
import { seasonalPill } from "./seasonalPill";
import { heroSearchTargets, TASK_CHIPS } from "./heroSearch";
import PhoneMock from "./PhoneMock";

/**
 * Hero (owner-approved landing redesign, 2026-10-20): seasonal pill, Bodoni H1
 * with the rust italic "partner.", subhead, one search for all four sections
 * with a "Search" pill, example chips that fill the search, and an HTML/CSS
 * phone mock (no image). Two columns from lg, one stacked column below.
 *
 * Honesty rules (LANDING-APPROVED.md): the chips carry no prices (no real
 * completed-job price data behind them yet); the pill follows the month
 * (seasonalPill); the search really searches (heroSearch.ts); no parish select
 * (owner, 2026-10-20).
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const pill = seasonalPill(new Date().getMonth());

  // Defer the auth check until the first interaction (or 25 s) so the Supabase
  // chunk never joins the landing's first paint. Every action re-checks the
  // session itself (goSignedInOr), so this only picks the Browse link's target.
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

  // Search: a signed-out visitor gets the public Jobs board with the words;
  // a signed-in one gets Jobs > Browse with them (heroSearch.ts).
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const t = heroSearchTargets(query);
    void goSignedInOr(navigate, t.signedIn, t.signedOut);
  };

  return (
    <section className="relative px-5 sm:px-8 lg:px-12 pt-24 sm:pt-28 lg:pt-36 pb-16 sm:pb-20 lg:pb-28">
      <div className="landing-hero-grid relative mx-auto w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-12 lg:gap-16">
        <div className="flex flex-col items-start gap-5 sm:gap-6 min-w-0">
          <p
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-ds-12 sm:text-ds-13 font-semibold max-w-full"
            style={{ background: "var(--lp-surface)", color: "var(--lp-ink)", border: "1px solid var(--lp-line)" }}
            data-testid="landing-season"
          >
            <CloudSun className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden style={{ color: "var(--lp-action-strong)" }} />
            <span className="min-w-0">{pill}</span>
          </p>

          <h1
            className="landing-h1 relative z-10 font-display font-bold leading-[0.98] text-balance break-words text-[3.25rem] min-[400px]:text-[3.75rem] sm:text-[4.5rem] lg:text-[5rem] xl:text-[5.75rem]"
            style={{ color: "var(--lp-ink)", letterSpacing: "-0.03em" }}
          >
            Louisiana&rsquo;s local{" "}
            <em className="relative inline-block" style={{ fontStyle: "italic", color: "var(--lp-money)" }}>
              partner.
            </em>
          </h1>

          <p
            className="max-w-xl text-ds-15 sm:text-ds-17 leading-relaxed"
            style={{ fontFamily: "Montserrat, system-ui, sans-serif", fontWeight: 400, color: "var(--lp-body)" }}
          >
            Hire help or find work. Sell or find a deal. Shop local or open a shop. Find a place or list one. One account, one verified ID, real neighbors.
          </p>

          <form
            onSubmit={search}
            role="search"
            aria-label="Search Helpr"
            className="landing-search w-full max-w-xl flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1.5 sm:p-1.5"
            data-testid="landing-search"
          >
            <label htmlFor={inputId} className="sr-only">Search jobs, items, shops and homes</label>
            <div className="landing-search-field w-full sm:w-auto sm:flex-1 min-w-0 shrink-0 flex items-center gap-2 sm:gap-2.5 px-4 sm:pl-4 sm:pr-2 h-14 sm:h-12">
              <Search className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} aria-hidden style={{ color: "var(--lp-muted)" }} />
              <input
                ref={inputRef}
                id={inputId}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={80}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search jobs, items, shops and homes"
                className="w-full min-w-0 bg-transparent outline-none text-ds-16 placeholder:text-[color:var(--lp-muted)] placeholder:opacity-70 placeholder:text-ds-14 max-[399px]:placeholder:text-ds-13 max-[349px]:placeholder:text-ds-12"
                style={{ color: "var(--lp-ink)" }}
              />
            </div>
            <Button
              type="submit"
              className="btn-grad-primary h-14 sm:h-12 w-full sm:w-auto rounded-full px-7 text-ds-15 font-semibold shrink-0"
              data-testid="landing-search-submit"
            >
              Search
            </Button>
          </form>

          <ul className="flex flex-wrap gap-2 max-w-xl" aria-label="Popular searches">
            {TASK_CHIPS.map((chip) => (
              <li key={chip}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(chip);
                    inputRef.current?.focus();
                  }}
                  className="landing-chip min-h-11 rounded-full px-4 text-ds-13 font-medium transition-colors"
                >
                  {chip}
                </button>
              </li>
            ))}
          </ul>

          {/* The feed this visitor can use: the guest board, or Jobs > Browse once signed in. */}
          <Link
            to={loggedIn ? "/jobs" : "/browse"}
            className="group inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold underline-offset-4 hover:underline"
            style={{ color: "var(--lp-action-strong)" }}
          >
            Browse local jobs
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>

        <PhoneMock />
      </div>
    </section>
  );
};

export default HeroSection;
