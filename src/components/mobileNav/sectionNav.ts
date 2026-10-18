import { Home, Briefcase, Sofa, Store, KeyRound, type LucideIcon } from "lucide-react";
import { useFeature } from "@/hooks/useFeature";

/**
 * THE ONE LIST of the app's sections (owner, 2026-10-18: bottom bar = Home +
 * Jobs & Posts + Declutter + Shops + Homes, icons only; the desktop rail and
 * the Home hub carry the same set). MobileNav, DesktopSidebarNav and the Home
 * hub all read it, so the three can never disagree about which sections exist
 * or which switch hides one.
 *
 * - `featureKey`: the hidden switch that hides the section for a viewer it is
 *   off for. NEVER change a switch's audience to show a section (owner
 *   decision; agents never touch switch audiences).
 * - `label`: the screen-reader name of an icon-only tab (U1) and the rail's
 *   visible word. The bar shows no words (owner, 2026-10-17).
 * - `stack`: routes whose page and sub-pages light the tab and pop back to its
 *   root on tap (a section's own root is listed to cover its sub-pages).
 * - `post`: the labeled '+' pill in the section's own header (no '+' in the bar).
 *
 * Guard: src/test/sectionNavOneList.test.ts.
 */
export type SectionKey = "home" | "jobs" | "declutter" | "shops" | "homes";
export type SectionFeatureKey = "declutter" | "shops" | "rentals";

export interface SectionNavItem {
  key: SectionKey;
  path: string;
  icon: LucideIcon;
  label: string;
  featureKey: SectionFeatureKey | null;
  stack: string[];
  badgeKey?: "posts+jobs";
  post: { label: string; path: string } | null;
}

export const SECTION_NAV: readonly SectionNavItem[] = [
  // Home hub: a brief preview of every section (owner, 2026-10-18 ~00:20Z).
  { key: "home", path: "/hub", icon: Home, label: "Home", featureKey: null, stack: [], post: null },
  // Jobs & Posts: today's job feed (/home) plus My posts / My jobs.
  {
    key: "jobs",
    path: "/home",
    icon: Briefcase,
    label: "Jobs & Posts",
    featureKey: null,
    stack: ["/posts", "/jobs", "/quotes"],
    badgeKey: "posts+jobs",
    post: { label: "Post", path: "/post-job" },
  },
  {
    key: "declutter",
    path: "/declutter",
    icon: Sofa,
    label: "Declutter",
    featureKey: "declutter",
    stack: ["/declutter"],
    post: { label: "Sell", path: "/declutter/sell" },
  },
  {
    key: "shops",
    path: "/shops",
    icon: Store,
    label: "Shops",
    featureKey: "shops",
    stack: ["/shops"],
    post: { label: "Add item", path: "/shops/mine" },
  },
  // Homes = Rentals renamed (Rent | Buy, owner 2026-10-18); the route stays
  // /rentals until the rentals lane renames it.
  {
    key: "homes",
    path: "/rentals",
    icon: KeyRound,
    label: "Homes",
    featureKey: "rentals",
    stack: ["/rentals"],
    post: { label: "List", path: "/rentals?add=1" },
  },
];

/** Pure: the sections a viewer sees, given which switches are on for them. */
export function visibleSections(
  on: Record<SectionFeatureKey, boolean>,
): SectionNavItem[] {
  return SECTION_NAV.filter((s) => s.featureKey === null || on[s.featureKey] === true);
}

/** The sections this viewer sees. A section whose switch is off (or still
 *  loading, or errored: useFeature reads those as off) is not offered. */
export function useVisibleSections(): SectionNavItem[] {
  const declutter = useFeature("declutter");
  const shops = useFeature("shops");
  const rentals = useFeature("rentals");
  return visibleSections({ declutter, shops, rentals });
}

/** Pure: is `pathname` one of the section's stack routes or below one. */
export function inSectionStack(item: SectionNavItem, pathname: string): boolean {
  return item.stack.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Which section a pathname belongs to (null: none, e.g. /profile). */
export function sectionForPath(pathname: string): SectionNavItem | null {
  for (const s of SECTION_NAV) {
    if (pathname === s.path) return s;
  }
  for (const s of SECTION_NAV) {
    if (inSectionStack(s, pathname)) return s;
  }
  return null;
}

/**
 * A section's inbox (each section header's Messages button opens
 * `/messages?section=<key>`, owner 2026-10-18: "only that section's chats,
 * never mixed"). The section of a thread comes from what it is about: every
 * thread in `messages` today is about a JOB (Conversation.jobId), so Jobs &
 * Posts (and the unfiltered inbox) keep them all, and Declutter, Shops and
 * Homes have none yet: those sections have no in-app threads to show (tracked
 * in docs/OPEN.md). Never mixes a job thread into another section.
 */
export function inboxForSection<T>(section: string | null, conversations: T[]): T[] {
  if (section === "declutter" || section === "shops" || section === "homes") return [];
  return conversations;
}
