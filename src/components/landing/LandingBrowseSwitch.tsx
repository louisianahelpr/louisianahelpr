import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LiveJobsSection } from "./LiveJobsSection";
import { FreshDeclutterSection } from "./FreshDeclutterSection";

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
type LandingMode = "jobs" | "declutter";

export const LANDING_MODE_KEY = "lh.landing.mode";
/** The hash a shared link uses to open on Declutter: https://www.louisianahelpr.com/#declutter */
const LANDING_DECLUTTER_HASH = "#declutter";

const OPTIONS = [
  { value: "jobs", label: "Find help or work" },
  { value: "declutter", label: "Shop Declutter" },
] as const;

/** The remembered pick, or null (none saved, or storage unavailable: a private window, blocked site data). */
function readSavedMode(): LandingMode | null {
  try {
    const v = window.localStorage.getItem(LANDING_MODE_KEY);
    return v === "jobs" || v === "declutter" ? v : null;
  } catch {
    // Storage can throw in a private window or with site data blocked: no remembered pick, so the default (jobs).
    return null;
  }
}

function saveMode(mode: LandingMode) {
  try {
    window.localStorage.setItem(LANDING_MODE_KEY, mode);
  } catch {
    // Remembering is a convenience only: the switch still works for this visit when storage is unavailable.
  }
}

/** /#declutter wins; then the remembered pick; then jobs. */
function initialMode(hash: string): LandingMode {
  if (hash === LANDING_DECLUTTER_HASH) return "declutter";
  return readSavedMode() ?? "jobs";
}

export function LandingBrowseSwitch() {
  const { hash } = useLocation();
  const [mode, setMode] = useState<LandingMode>(() => initialMode(hash));

  // A /#declutter link followed while the landing is already open (the footer, a pasted link) switches too.
  useEffect(() => {
    if (hash === LANDING_DECLUTTER_HASH) setMode("declutter");
  }, [hash]);

  const choose = (next: LandingMode) => {
    setMode(next);
    saveMode(next);
  };

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
