import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goSignedInOr } from "./goSignedInOr";
import { heroSearchTargets } from "./heroSearch";
import { LandingProof } from "./LandingProof";

/**
 * Hero (owner-approved landing redesign 2026-10-20; option B 2026-10-23): Bodoni
 * H1 with the rust italic "partner.", the subhead (one line from 1024px), one
 * search, then the proof row (LandingProof). ONE centered column (max 760px) at
 * every width; the proof row below it may run wider. No phone mock (owner,
 * 2026-10-20), no seasonal pill and no example chips (owner, 2026-10-23: "remove
 * the storm banner and job chips"). The live jobs sit in the next section
 * (LiveJobsSection), which also carries the "Browse local jobs" link.
 *
 * Honesty rules (LANDING-APPROVED.md): the search really searches
 * (heroSearch.ts); no parish select (owner, 2026-10-20); every proof line is a
 * checked fact (LandingProof.tsx).
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputId = useId();

  // Search: a signed-out visitor gets the public Jobs board with the words;
  // a signed-in one gets Jobs > Browse with them (heroSearch.ts).
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const t = heroSearchTargets(query);
    void goSignedInOr(navigate, t.signedIn, t.signedOut);
  };

  return (
    <section className="relative px-5 sm:px-8 lg:px-12 pt-24 sm:pt-28 lg:pt-32 pb-12 sm:pb-14 lg:pb-16">
      <div className="relative mx-auto w-full max-w-[760px]">
        <div data-testid="landing-hero-column" className="flex flex-col items-center text-center min-w-0">
          <h1
            className="landing-h1 relative z-10 font-display font-bold leading-[1] text-balance break-words text-[3.25rem] min-[400px]:text-[3.5rem] sm:text-[4.75rem] lg:text-[6.5rem] xl:text-[7.75rem]"
            style={{ color: "var(--lp-ink)", letterSpacing: "-0.03em" }}
          >
            Louisiana&rsquo;s local{" "}
            <em className="relative inline-block" style={{ fontStyle: "italic", color: "var(--lp-money)" }}>
              partner.
            </em>
          </h1>

          <p
            className="mt-7 lg:mt-9 text-ds-16 sm:text-ds-18 lg:text-ds-22 xl:text-ds-24 leading-relaxed lg:whitespace-nowrap"
            style={{ fontFamily: "Montserrat, system-ui, sans-serif", fontWeight: 400, color: "var(--lp-body)" }}
          >
            Hire help or find work. One account, real neighbors.
          </p>

          <form
            onSubmit={search}
            role="search"
            aria-label="Search Helpr"
            className="landing-search mt-9 lg:mt-12 w-full max-w-xl lg:max-w-[720px] text-left flex items-center gap-1.5 p-1.5 lg:p-2"
            data-testid="landing-search"
          >
            <label htmlFor={inputId} className="sr-only">Search local jobs</label>
            <div className="landing-search-field flex-1 min-w-0 flex items-center gap-2.5 pl-4 lg:pl-5 pr-1 h-12 lg:h-14">
              <Search className="hidden sm:block w-[18px] h-[18px] lg:w-5 lg:h-5 shrink-0" strokeWidth={1.75} aria-hidden style={{ color: "var(--lp-muted)" }} />
              <input
                id={inputId}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={80}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search local jobs"
                className="w-full min-w-0 bg-transparent outline-none text-ds-16 lg:text-ds-18 placeholder:text-[color:var(--lp-muted)] placeholder:opacity-70"
                style={{ color: "var(--lp-ink)" }}
              />
            </div>
            <Button
              type="submit"
              className="btn-grad-primary h-12 w-12 sm:w-auto lg:h-14 rounded-full p-0 sm:px-7 lg:px-9 text-ds-15 lg:text-ds-18 font-semibold shrink-0"
              data-testid="landing-search-submit"
              aria-label="Search"
            >
              <Search className="sm:hidden w-5 h-5" strokeWidth={2} aria-hidden />
              <span className="hidden sm:inline">Search</span>
            </Button>
          </form>
        </div>
      </div>
      <LandingProof />
    </section>
  );
};

export default HeroSection;
