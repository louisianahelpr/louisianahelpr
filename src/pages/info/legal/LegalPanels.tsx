import { TabsContent } from "@/components/ui/tabs";
import { TermsContent } from "./TermsSection";
import { CommunityContent } from "./CommunitySection";
import { PrivacyContent } from "./PrivacySection";

// Moved out of Legal.tsx unchanged (Q806).
// Smooth cross-tab transition — each panel fades + slides in on mount.
// Radix TabsContent unmounts inactive tabs, so switching tabs remounts
// the new panel, which replays the CSS `fade-in` keyframe (12px rise, the
// same 350 ms curve framer ran; Q1719 moved it off framer-motion).
// `motion-safe:` keeps it off for Reduce Motion, as useReducedMotion did.
const panelFade = "motion-safe:animate-[fade-in_350ms_cubic-bezier(0.22,1,0.36,1)_both]";
export function LegalPanels() {
  return (
    <>
      <TabsContent value="terms" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <div key="terms-panel" className={panelFade}>
          <TermsContent />
        </div>
      </TabsContent>
      <TabsContent value="community" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <div key="community-panel" className={panelFade}>
          <CommunityContent />
        </div>
      </TabsContent>
      <TabsContent value="privacy" className="mt-0" style={{ paddingBottom: "1rem" }}>
        <div key="privacy-panel" className={panelFade}>
          <PrivacyContent />
        </div>
      </TabsContent>
    </>
  );
}
