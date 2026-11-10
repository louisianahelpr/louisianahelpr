import { lazy, Suspense, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { useLiveJobs } from "./LiveJobsSection";
import { FRESH_DECLUTTER_LIMIT, FRESH_GRID, FRESH_INCL, FRESH_PRICE, FRESH_TITLE, FRESH_TOWN, useFreshItems } from "./FreshDeclutterSection";
import { mixNearCards } from "./nearYouCards";
import { LANDING_DECLUTTER_HASH, setLandingMode, useLandingMode } from "./landingMode";
import { sectionIsComingSoon, useSectionsOpen } from "./useSectionsOpen";

// The grid's markup is its own chunk, fetched alongside the listings (useFreshItems), never with the page.
const NearYouGrid = lazy(() => import("./FreshDeclutterStrip"));

/**
 * "Near you this week" (Direction A, "Porch and Parish", owner 11-10): right under the photo band, the newest open jobs
 * and the popular Declutter listings in ONE grid, each with its town and price (list price first on an item), in place
 * of the old Jobs | Declutter section and the "Four ways" cards. The hero's Jobs | Declutter switch decides which kind
 * leads (mixNearCards); /#declutter opens on Declutter.
 *
 * D003 (11-10, High): never an empty card. With no open job the grid is all Declutter items; with nothing at all to
 * show, the section is not drawn. Until both reads answer, a placeholder grid of the real cards' size holds the place
 * (L002's rule: the page does not jump when the cards land).
 *
 * Below the fold on every screen (the photo band sits between), so nothing here joins the first paint: the reads wait
 * for the page to load and the section to near the screen (useLiveJobs, useFreshItems).
 */
const NEAR_YOU_TITLE = "Near you this week";
const NEAR_YOU_LINE = "Open jobs and things for sale, from your neighbors.";
/** D016 (11-10): the towns where most members live (non-seed profiles by ZIP, read-only on prod 11-10). */
export const SERVICE_AREA_LINE = "Serving New Iberia, Lafayette, Abbeville and nearby.";

/** "Shops and Homes are on the way." (owner's preview tweak 3, 11-10: the sections still coming, in one line). */
export function onTheWayLine(labels: string[]): string {
  const names = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} ${labels.length === 1 ? "is" : "are"} on the way.`;
}

function SeeLink({ to, label, className = "" }: { to: string; label: string; className?: string }) {
  return (
    <Link to={to} className={`group inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard ${className}`} style={{ color: "var(--lp-action-strong)" }}>
      {label}
      <ArrowRight className="w-4 h-4" aria-hidden />
    </Link>
  );
}

/** The placeholder: FRESH_DECLUTTER_LIMIT empty cards of the real card's size (4:5 tile, two-line title, town, price, incl.-fee line). */
function NearYouSkeleton() {
  return (
    <ul className={FRESH_GRID} aria-hidden data-testid="landing-near-you-skeleton">
      {Array.from({ length: FRESH_DECLUTTER_LIMIT }, (_, i) => (
        <li key={i} className="min-w-0">
          <span className="block aspect-[4/5] rounded-xl bg-photo-empty" />
          <span className="block px-0.5 pt-2">
            <span className={`block ${FRESH_TITLE}`}>&nbsp;<br />&nbsp;</span>
            <span className={`block ${FRESH_TOWN}`}>&nbsp;</span>
            <span className={`mt-0.5 block ${FRESH_PRICE}`}>&nbsp;</span>
            <span className={`block ${FRESH_INCL}`}>&nbsp;</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NearYouSection() {
  const ref = useRef<HTMLElement>(null);
  const jobs = useLiveJobs(ref);
  const items = useFreshItems(ref);
  const mode = useLandingMode();
  const { hash } = useLocation();
  // A /#declutter link followed while the landing is already open (the footer, a pasted link) switches too.
  useEffect(() => {
    if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter", false);
  }, [hash]);

  const pending = jobs.kind === "loading" || items.kind === "waiting";
  const cards = mixNearCards(jobs.kind === "ok" ? jobs.jobs : [], items.kind === "ok" ? items.items : [], mode);
  const bothFailed = jobs.kind === "failed" && items.kind === "failed";
  // The sections still on the way, once this section is on its way in (never at first paint).
  const { open } = useSectionsOpen(!pending);
  const later = SECTIONS.filter((s) => s.feature !== null && s.feature !== "declutter" && sectionIsComingSoon(s.feature, open)).map((s) => s.navLabel);

  // D003: nothing to show (both answered, both empty) draws no section at all, never an empty card.
  if (!pending && !bothFailed && cards.length === 0) return <span ref={ref} id="declutter" data-testid="landing-near-you-none" hidden />;

  return (
    <section
      ref={ref}
      id="declutter"
      aria-labelledby="landing-near-you-title"
      data-testid="landing-near-you"
      data-mode={mode}
      className="scroll-mt-20 px-5 sm:px-8 lg:px-12 pt-10 pb-12 lg:pt-16 lg:pb-20"
      style={{ background: "var(--lp-surface)" }}
    >
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-2 min-w-0">
            <h2 id="landing-near-you-title" className="font-display landing-serif landing-h2" style={{ color: "var(--lp-ink)" }}>
              {NEAR_YOU_TITLE}
            </h2>
            <p className="text-ds-15" style={{ color: "var(--lp-body)" }}>{NEAR_YOU_LINE}</p>
          </div>
          {/* D012: the landing's verbs, one link per destination. */}
          <div className="flex flex-wrap items-center gap-x-5" data-testid="landing-near-you-links">
            <SeeLink to="/browse" label="Browse jobs" />
            <SeeLink to="/declutter" label="Shop Declutter" />
          </div>
        </div>
        {bothFailed ? (
          <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-near-you-failed">
            We couldn’t load what’s near you just now. Browse jobs or shop Declutter for everything.
          </p>
        ) : pending ? (
          <NearYouSkeleton />
        ) : (
          <Suspense fallback={<NearYouSkeleton />}>
            <NearYouGrid cards={cards} />
          </Suspense>
        )}
        <div className="flex flex-col gap-1 text-ds-14" style={{ color: "var(--lp-muted)" }}>
          <p data-testid="landing-service-area">{SERVICE_AREA_LINE}</p>
          {later.length > 0 && <p data-testid="landing-sections-later">{onTheWayLine(later)}</p>}
        </div>
      </div>
    </section>
  );
}
