import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goSignedInOr } from "./goSignedInOr";
import { heroSearchTargets } from "./heroSearch";
import { useHeroWords } from "./useHeroWords";
import { removeLandingShellOncePainted } from "./landingShell";

/**
 * Hero (owner-approved landing redesign 2026-10-20; option B 2026-10-23): Bodoni
 * H1, the subhead (one line from 1024px), one
 * search. ONE centered column (max 760px) at every width. The proof row
 * (LandingProof) is NOT here: it opens the next section, below the fold (owner,
 * 2026-11-02: the first screen is just the headline, subhead and search). No phone mock (owner,
 * 2026-10-20), no seasonal pill and no example chips (owner, 2026-10-23: "remove
 * the storm banner and job chips"). The live jobs sit in the next section
 * (LiveJobsSection), which also carries the "Browse local jobs" link.
 *
 * Owner decision 11-18 (hero mockup B, "Color band"; overrides the 11-17 "white everywhere" rule for the hero only):
 * a soft olive-to-cream band (.landing-hero-band, pure CSS) behind the whole hero, the bar included, and "partner."
 * italic in the brand olive (.landing-h1-accent). The wording is unchanged. Guard: landingHeroBand1118.test.ts.
 * Owner 11-18 later ("the landing view gets the full view also light up the green background"): the band is lighter
 * (closer to cream) and the hero fills the whole first screen on a phone too. Guard: landingHeroFullScreen1118.test.ts.
 *
 * Honesty rules (LANDING-APPROVED.md): the search really searches
 * (heroSearch.ts); no parish select (owner, 2026-10-20); every proof line is a
 * checked fact (LandingProof.tsx, now in LiveJobsSection).
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputId = useId();
  // Spanish only when the visitor's language is Spanish; English (null) is the locked copy below, unchanged.
  const es = useHeroWords();
  // B100: index.html drew this hero before the app loaded (#lh-landing-shell); take that copy away once this one is painted.
  useEffect(() => removeLandingShellOncePainted(), []);
  // Owner 11-18 ("remove this on the landing and the search just be used for both"): no Jobs | Declutter tabs; the one
  // box searches jobs AND Declutter (heroSearch.ts -> /search, which lists both, signed in or out).
  const searchLabel = es ? es.searchLabel : "Search jobs and Declutter";

  // Search: the words open /search (jobs and Declutter together) for a guest or a member (heroSearch.ts).
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const t = heroSearchTargets(query);
    void goSignedInOr(navigate, t.signedIn, t.signedOut);
  };

  return (
    // The first screen (owner, 2026-10-27: "it just needs to be centered on the page with the stuff
    // below smaller"): the H1, subhead and search are one block centred under the top bar's clearance.
    // The proof row moved below the fold (owner, 2026-11-02). Owner 11-18 ("make the jobs move down some so you
    // have to scroll to see"): the section fills the whole first screen at every width, phone included (the 11-08
    // phone peek is gone); its height is .landing-hero-band's min-height in src/index.css (100vh, then 100svh). The
    // top bar is drawn over the band, so the full screen height already counts the bar.
    <section className="landing-hero-band relative flex flex-col px-5 sm:px-8 lg:px-12 pt-32 sm:pt-28 lg:pt-24 pb-8 lg:pb-10">
      <div data-testid="landing-hero-block" className="flex flex-1 flex-col justify-center">
        <div className="relative mx-auto w-full max-w-[760px]">
          <div data-testid="landing-hero-column" className="flex flex-col items-center text-center min-w-0">
            <h1
              className="landing-h1 relative z-10 landing-serif-text font-bold leading-[1] text-balance break-words text-[3.25rem] min-[400px]:text-[3.5rem] sm:text-[4.75rem] lg:text-[6.5rem] xl:text-[7.75rem]"
              style={{ color: "var(--lp-ink)", letterSpacing: "-0.03em" }}
            >
              {es ? es.titleLead : <>Louisiana&rsquo;s local</>}{" "}
              <span className="landing-h1-accent">{es ? es.titleAccent : "partner."}</span>
            </h1>

            <p
              // eslint-disable-next-line no-restricted-syntax -- the LOCKED landing hero subhead keeps its own sizes (CLAUDE.md), exempt from the Q2027 five-size scale
              className="mt-6 lg:mt-7 text-[16px] sm:text-[17px] lg:text-[20px] leading-relaxed lg:whitespace-nowrap"
              style={{ fontFamily: "Montserrat, system-ui, sans-serif", fontWeight: 400, color: "var(--lp-body)" }}
            >
              {es ? es.subhead : "Hire help, find work, or buy and sell. One account, real neighbors."}
            </p>

            <form
              onSubmit={search}
              role="search"
              aria-label="Search Helpr"
              className="landing-search mt-8 lg:mt-10 w-full max-w-xl lg:max-w-[640px] text-left flex items-center gap-1.5 p-1.5"
              data-testid="landing-search"
            >
              <label htmlFor={inputId} className="sr-only">{searchLabel}</label>
              <div className="landing-search-field flex-1 min-w-0 flex items-center gap-2.5 pl-4 lg:pl-5 pr-1 h-12 lg:h-[52px]">
                <Search className="hidden sm:block w-[18px] h-[18px] lg:w-5 lg:h-5 shrink-0" aria-hidden style={{ color: "var(--lp-muted)" }} />
                <input
                  id={inputId}
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  maxLength={80}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchLabel}
                  className="w-full min-w-0 bg-transparent outline-none text-ds-16 lg:text-ds-17 placeholder:text-[color:var(--lp-muted)] placeholder:opacity-70"
                  style={{ color: "var(--lp-ink)" }}
                />
              </div>
              <Button
                type="submit"
                className="btn-grad-primary h-12 w-12 sm:w-auto lg:h-[52px] rounded-full p-0 sm:px-7 lg:px-8 text-ds-15 lg:text-ds-16 font-semibold shrink-0"
                data-testid="landing-search-submit"
                aria-label={es ? es.searchButton : "Search"}
              >
                <Search className="sm:hidden w-5 h-5" aria-hidden />
                <span className="hidden sm:inline">{es ? es.searchButton : "Search"}</span>
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
