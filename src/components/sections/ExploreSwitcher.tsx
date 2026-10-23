import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { safeStorage } from "@/lib/safeStorage";
import { useSectionTabs, comingSoonLabel, sectionComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useSectionPrefs } from "./useSectionPrefs";
import { sectionByKey, type SectionDef, type SectionKey } from "./sectionsConfig";
import { SoonPill } from "./SoonPill";

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

/** Is this live section a tester-only preview for the viewer (useSectionTabs `preview`)? Jobs never is. */
export function useSectionIsPreview() {
  const live = useSectionTabs();
  return (s: SectionDef) => s.feature !== null && !!live.find((t) => t.path === s.path)?.preview;
}

/** One section's preview answer: its empty Browse says "Opens soon" to a tester (owner, 2026-10-22). */
export function useSectionPreview(key: SectionKey): boolean {
  return useSectionIsPreview()(sectionByKey(key));
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
 * Owner 2026-10-22 (the Explore header): the row is the header's TOP line, compact
 * chips beside the bell and the photo (AppTopBar), still the quiet tone of 2026-10-21
 * (the Browse/Posted/Working tabs under it are now thin underlines). A section
 * not open to everyone says "Coming soon" under its name, for every viewer: muted and
 * inert when it is closed to them (no toast, no navigation), and still opening for a
 * tester, whose section then carries the "early preview" banner (SectionPreviewBanner).
 * Guards: src/test/sectionNavTabs.test.tsx, src/test/exploreHeaderSteady.test.ts.
 */
export function ExploreSwitcher({ current }: { current: SectionKey }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const isWebDesktop = useIsWebDesktop();
  const { visible } = useSectionPrefs();
  const isOn = useSectionIsOn();
  const isPreview = useSectionIsPreview();
  useEffect(() => writeLastSection(user?.id, current), [user?.id, current]);
  // FOUR CHIPS ON ONE LINE, EVEN WHEN THEY DO NOT FIT (measured 2026-10-23, WebKit: the track is 237px at 375 and
  // the chips 278px once three say "Coming soon"): the row scrolls sideways, the open section's chip is scrolled
  // into view, and a fade at the right edge says there is more, until the end is reached.
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const track = navRef.current?.querySelector<HTMLElement>("[role='radiogroup']");
    if (!track) return;
    const update = () => setMore(track.scrollWidth - track.clientWidth - track.scrollLeft > 2);
    // The chips change width after mount ("Coming soon" appears once the sections' answer lands), so the picked chip
    // is brought into view, and the fade re-measured, whenever the track's content resizes.
    const reveal = () => {
      const picked = track.querySelector<HTMLElement>("[aria-checked='true']");
      if (picked && picked.offsetLeft + picked.offsetWidth > track.scrollLeft + track.clientWidth) {
        track.scrollLeft = picked.offsetLeft + picked.offsetWidth - track.clientWidth;
      }
      update();
    };
    reveal();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    for (const chip of Array.from(track.children)) ro?.observe(chip);
    track.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      track.removeEventListener("scroll", update);
    };
  }, [current, visible.length]);
  if (isWebDesktop) return null;
  const options = visible.map((s) => {
    const on = isOn(s);
    // ONE word for a section not open to everyone (owner, 2026-10-22): "Coming soon", for a member (closed: a tap
    // does nothing) and for a tester alike (open to them; inside, the "early preview" banner says why).
    const soon = sectionComingSoon({ on, preview: isPreview(s) });
    return {
      value: s.key,
      label: soon ? (
        <span data-soon="" className="flex flex-col items-center leading-[1.15]">
          <span className={on ? undefined : "text-muted-foreground font-medium"}>{s.navLabel}</span>
          <SoonPill variant="caption" data-coming-soon="" />
        </span>
      ) : (
        s.navLabel
      ),
      ariaLabel: soon ? comingSoonLabel(s.navLabel) : s.navLabel,
    };
  });
  // A <nav>: it moves between the four sections, and it is the same chrome on a
  // section's loading frame and on its page, so the page-settle sampler (which
  // skips nav) never counts it as the page arriving (settleSkeletonIsNeverContent).
  return (
    <nav ref={navRef} data-testid="explore-switcher" aria-label="Sections" className={more ? "explore-chips-more" : undefined}>
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
        // THE EXPLORE HEADER'S TOP ROW (owner, 2026-10-22): one line of compact chips beside the bell and the photo,
        // still the lighter (quiet) control of 2026-10-21. A row too narrow for four chips (320) scrolls sideways
        // rather than cutting a name.
        tone="quiet"
        className="w-full overflow-x-auto no-scrollbar"
        optionClassName="px-1.5 text-ds-11 whitespace-nowrap"
      />
    </nav>
  );
}
