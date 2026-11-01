import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { readLastSection, useSectionIsListed, useSectionIsOn } from "@/components/sections/ExploreSwitcher";
import { sectionByKey } from "@/components/sections/sectionsConfig";

/**
 * /explore (the bottom bar's Explore tab, owner 2026-10-20): opens the section
 * the member was last in, else their first shown section that is open to them
 * (Jobs is always open). The sections themselves carry the Explore switcher.
 * Guard: src/test/centerCreateNav.test.tsx.
 */
export default function Explore() {
  const { user } = useCurrentUser();
  const { visible } = useSectionPrefs();
  const isOn = useSectionIsOn();
  const last = readLastSection(user?.id);
  const isListed = useSectionIsListed();
  // In the iPhone app a tester-only preview is never the section Explore opens on (owner 10-31, hideUnopenedInApp).
  const open = visible.filter((s) => isOn(s) && isListed(s));
  // Jobs has no switch, so it is the safe fallback when every shown section is closed.
  const target = open.find((s) => s.key === last) ?? open[0] ?? sectionByKey("jobs");
  return <Navigate replace to={target.path} />;
}
