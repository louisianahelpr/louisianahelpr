import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LiveJobsSection } from "./LiveJobsSection";
import { FreshDeclutterSection } from "./FreshDeclutterSection";
import { LANDING_DECLUTTER_HASH, setLandingMode } from "./landingMode";

/**
 * The sections right under the hero (owner 11-08: a member could not find Declutter items on the landing).
 *
 * Owner 11-18 ("can we remove this on the landing and the search just be used for both?"): the hero's Jobs | Declutter
 * tabs are gone, so nothing picks one or the other here either: the live jobs come first, then the Declutter grid in
 * the browse card style with "Shop Declutter" to /declutter. (D001, 11-10, had already removed this section's own
 * second switch.)
 *
 * /#declutter scrolls to the Declutter grid (id="declutter") so a Facebook link lands there, and turns How it works
 * to its "Buy or sell" side (landingMode.ts). The Declutter grid's read waits for the page to load and the spot to
 * near the screen (FreshDeclutterSection), so the landing's first paint is unchanged.
 */
export function LandingBrowseSwitch() {
  const { hash } = useLocation();

  // A /#declutter link followed while the landing is already open (the footer, a pasted link) turns How it works too.
  useEffect(() => {
    if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter");
  }, [hash]);

  return (
    <div data-testid="landing-browse-switch" style={{ background: "var(--lp-surface)" }}>
      <LiveJobsSection />
      {/* id="declutter": Index scrolls a /#declutter visit here. */}
      <div id="declutter" data-testid="landing-declutter" className="scroll-mt-20">
        <FreshDeclutterSection />
      </div>
    </div>
  );
}
