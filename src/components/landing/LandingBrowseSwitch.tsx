import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LiveJobsSection } from "./LiveJobsSection";
import { FreshDeclutterSection } from "./FreshDeclutterSection";
import { LANDING_DECLUTTER_HASH, setLandingMode, useLandingMode, type LandingMode } from "./landingMode";

/**
 * Jobs | Declutter switch (owner 11-08: a member could not find Declutter items on the landing; the "Fresh on
 * Declutter" strip sat about 1.5 screens down under the jobs). Right under the hero, two buttons: "Find help or work"
 * (the live jobs, the default) and "Shop Declutter" (a grid of the newest Declutter items in the browse card style, in
 * place of the jobs, then "See everything" to /declutter).
 *
 * The visitor's last pick is remembered in this browser (localStorage, best effort), and /#declutter opens straight on
 * Declutter so a Facebook link can land there. The Declutter grid is drawn only in Declutter mode, and its read waits
 * for the page to load and the spot to near the screen (FreshDeclutterSection), so the landing's first paint is the
 * same as before for both modes.
 */
const OPTIONS = [
  { value: "jobs", label: "Find help or work" },
  { value: "declutter", label: "Shop Declutter" },
] as const;

export function LandingBrowseSwitch() {
  const { hash } = useLocation();
  // F012 (11-09): the choice is shared with the hero search (landingMode.ts), so either control turns both.
  const mode = useLandingMode();

  // A /#declutter link followed while the landing is already open (the footer, a pasted link) switches too.
  useEffect(() => {
    if (hash === LANDING_DECLUTTER_HASH) setLandingMode("declutter", false);
  }, [hash]);

  const choose = (next: LandingMode) => setLandingMode(next);

  return (
    <>
      {/* id="declutter": Index scrolls a /#declutter visit here, so the switch and the grid are what it opens on. */}
      <div
        id="declutter"
        data-testid="landing-browse-switch"
        className="scroll-mt-20 px-5 sm:px-8 lg:px-12 pt-4 sm:pt-10 lg:pt-14"
        style={{ background: "var(--lp-surface)" }}
      >
        <div className="mx-auto w-full max-w-md">
          <SegmentedControl
            options={OPTIONS}
            value={mode}
            onChange={choose}
            ariaLabel="What to look at"
            semantics="tab"
            panelIdPrefix="landing-browse"
            optionClassName="text-ds-13 sm:text-ds-16 px-2 sm:px-4"
          />
        </div>
      </div>
      <div id={`landing-browse-panel-${mode}`} role="tabpanel" aria-labelledby={`landing-browse-tab-${mode}`}>
        {mode === "jobs" ? <LiveJobsSection /> : <FreshDeclutterSection />}
      </div>
    </>
  );
}
