import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LiveJobsSection } from "./LiveJobsSection";
import { FreshDeclutterSection } from "./FreshDeclutterSection";
import { LANDING_DECLUTTER_HASH, setLandingMode, useLandingMode } from "./landingMode";

/**
 * The section right under the hero (owner 11-08: a member could not find Declutter items on the landing). It follows
 * the hero's Jobs | Declutter choice (landingMode.ts): Jobs shows the live jobs, Declutter a grid of the popular
 * Declutter items in the browse card style, then "Shop Declutter" to /declutter.
 *
 * D001 (landing design audit 11-10, High): there used to be a SECOND switch here ("Find help or work | Shop
 * Declutter"), about 260px under the hero's own "Jobs | Declutter", with a different selected style. It is gone: the
 * hero's switch is the one switch, and this section simply follows it with a plain heading.
 *
 * /#declutter opens straight on Declutter so a Facebook link can land there. The Declutter grid is drawn only in
 * Declutter mode, and its read waits for the page to load and the spot to near the screen (FreshDeclutterSection), so
 * the landing's first paint is the same as before for both modes.
 */
export function LandingBrowseSwitch() {
  const { hash } = useLocation();
  const mode = useLandingMode();

  // A /#declutter link followed while the landing is already open (the footer, a pasted link) switches too.
  useEffect(() => {
    if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter", false);
  }, [hash]);

  return (
    // id="declutter": Index scrolls a /#declutter visit here, so the Declutter grid is what it opens on.
    <div id="declutter" data-testid="landing-browse-switch" data-mode={mode} className="scroll-mt-20" style={{ background: "var(--lp-surface)" }}>
      {mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />}
    </div>
  );
}
