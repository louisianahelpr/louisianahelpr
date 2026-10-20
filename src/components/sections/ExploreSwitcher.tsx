import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { safeStorage } from "@/lib/safeStorage";
import { useSectionTabs, sayComingSoon, comingSoonLabel } from "@/components/mobileNav/useSectionTabs";
import { useSectionPrefs } from "./useSectionPrefs";
import type { SectionDef, SectionKey } from "./sectionsConfig";

const LAST_KEY = "helpr_explore_last";

/** The section Explore reopens on, per member ("<key>:<userId>", never one global key). */
export function readLastSection(userId: string | undefined): SectionKey | null {
  if (!userId) return null;
  try {
    return (safeStorage.getItem(`${LAST_KEY}:${userId}`) as SectionKey | null) ?? null;
  } catch {
    return null; // storage blocked: Explore opens on the first section
  }
}

function writeLastSection(userId: string | undefined, key: SectionKey) {
  if (!userId) return;
  try {
    safeStorage.setItem(`${LAST_KEY}:${userId}`, key);
  } catch {
    /* best-effort: Explore reopens on the first section instead */
  }
}

/** Is this section open to the viewer (its switch on, or it has none)? */
export function useSectionIsOn() {
  const live = useSectionTabs();
  return (s: SectionDef) => s.feature === null || !!live.find((t) => t.path === s.path)?.on;
}

/**
 * EXPLORE'S SECTION SWITCHER (HELPR-DESIGN-SPEC §3 "Bottom bar", owner
 * 2026-10-20): the bottom bar's Explore tab holds the four sections as a
 * segmented control at the top of each section's screen, so all four are equal
 * and one tap apart. The member's Customize order, hidden ones left out. Each
 * section keeps its own Browse and "mine" tabs underneath, so "my stuff" is
 * Explore, then that tab. A section closed to the viewer shows muted and a tap
 * says "coming soon"; it never routes into it. Phone only: the desktop rail
 * already lists the sections. Guard: src/test/centerCreateNav.test.tsx.
 */
export function ExploreSwitcher({ current }: { current: SectionKey }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const isWebDesktop = useIsWebDesktop();
  const { visible } = useSectionPrefs();
  const isOn = useSectionIsOn();
  useEffect(() => writeLastSection(user?.id, current), [user?.id, current]);
  if (isWebDesktop) return null;
  const options = visible.map((s) => {
    const on = isOn(s);
    const Icon = s.icon;
    return {
      value: s.key,
      icon: <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden />,
      label: on ? s.navLabel : <span data-soon="" className="text-muted-foreground font-medium">{s.navLabel}</span>,
      ariaLabel: on ? s.navLabel : comingSoonLabel(s.navLabel),
    };
  });
  return (
    <div data-testid="explore-switcher">
      <SegmentedControl
        ariaLabel="Explore"
        options={options}
        value={current}
        onChange={(key) => {
          const s = visible.find((v) => v.key === key);
          if (!s) return;
          if (!isOn(s)) return sayComingSoon(s.label);
          navigate(s.path);
        }}
        iconPosition="top"
        className="w-full"
        optionClassName="px-1 text-ds-11 min-[360px]:text-ds-12 whitespace-nowrap"
      />
    </div>
  );
}
