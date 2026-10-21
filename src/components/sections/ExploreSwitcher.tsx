import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { safeStorage } from "@/lib/safeStorage";
import { useSectionTabs, comingSoonLabel } from "@/components/mobileNav/useSectionTabs";
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
 * Explore, then that tab. Phone only: the desktop rail already lists the
 * sections. Guard: src/test/centerCreateNav.test.tsx.
 *
 * Owner 2026-10-21: this row is the LIGHTER control (the quiet tone) so it never
 * reads as a second olive pill over the section's own Browse/Posted/Working
 * switch. A section closed to the viewer says "Soon" ON its tab, muted; a tap
 * does nothing (no toast popping up elsewhere on the screen, no navigation).
 * Guard: src/test/sectionNavTabs.test.tsx.
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
      icon: on ? (
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden />
      ) : (
        // "Soon" sits beside the muted icon, so the name below stays whole at 320.
        <span className="relative inline-flex">
          <Icon className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span data-soon-badge="" aria-hidden className="absolute -top-1.5 left-full -ml-0.5 rounded-full border border-border bg-card px-1 text-ds-9 font-semibold leading-[14px] text-muted-foreground">
            Soon
          </span>
        </span>
      ),
      label: on ? s.navLabel : <span data-soon="" className="text-muted-foreground font-medium">{s.navLabel}</span>,
      ariaLabel: on ? s.navLabel : comingSoonLabel(s.navLabel),
    };
  });
  // A <nav>: it moves between the four sections, and it is the same chrome on a
  // section's loading frame and on its page, so the page-settle sampler (which
  // skips nav) never counts it as the page arriving (settleSkeletonIsNeverContent).
  return (
    <nav data-testid="explore-switcher" aria-label="Sections">
      <SegmentedControl
        ariaLabel="Explore"
        options={options}
        value={current}
        onChange={(key) => {
          const s = visible.find((v) => v.key === key);
          // A "Soon" tab already says so on itself: a tap does nothing.
          if (!s || !isOn(s)) return;
          navigate(s.path);
        }}
        iconPosition="top"
        tone="quiet"
        className="w-full"
        optionClassName="px-1 text-ds-11 min-[360px]:text-ds-12 whitespace-nowrap"
      />
    </nav>
  );
}
