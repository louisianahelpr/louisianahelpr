import { toast } from "sonner";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { sectionItems } from "@/components/mobileNav/mobileNavHelpers";
import { useOpenToEveryoneAnswer } from "@/components/landing/useSectionsOpen";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";

/**
 * The section tabs (owner, 2026-10-18, option 1A): Declutter, Shops and Homes,
 * ALWAYS listed. A section whose feature switch is on for this viewer is live
 * (`on: true`); one whose switch is off is shown GREYED and never navigates:
 * tapping it says "coming soon" (owner, 2026-10-18: "show it greyed out so
 * everyone sees Declutter / Shops / Homes are coming"). The switch is only
 * READ here, never changed. useFeature is false while loading, on error and
 * signed out, so a section is never live for someone it is hidden from.
 *
 * The dock (MobileNav) and the desktop rail (DesktopSidebarNav) both read this
 * one list, so the two cannot drift.
 */
export function useSectionTabs() {
  const declutter = useFeature("declutter");
  const shops = useFeature("shops");
  const rentals = useFeature("rentals");
  // AUD31-73 (Guests on Declutter): useFeature is false signed out, so a guest browsing Declutter (open to everyone,
  // DeclutterGuestGate) saw its own chip greyed "Declutter Soon". For a guest, Declutter is live when it is open to
  // everyone (the same features_open_to_everyone answer the guest gate reads).
  const { user, isReady } = useAuthReady();
  const guest = isReady && !user;
  // Asked only once some section is live for this viewer, or for a guest: a member with nothing live never asks.
  const openToEveryone = useOpenToEveryoneAnswer(declutter || shops || rentals || guest);
  // Declutter only: it is the one section with guest pages (BUY-16's DeclutterGuestGate).
  const on = { declutter: declutter || (guest && !!openToEveryone?.has("declutter")), shops, rentals } as const;
  return sectionItems.map((s) => ({ ...s, on: on[s.feature], preview: sectionIsPreview(on[s.feature], s.feature, openToEveryone) }));
}

/**
 * The sections OPEN to this viewer, in config order: Jobs always (it has no
 * switch), and each section whose switch is on (A3-C13).
 */
export function useOpenSectionKeys(): SectionKey[] {
  const live = useSectionTabs();
  return SECTIONS.filter((s) => s.feature === null || !!live.find((t) => t.path === s.path)?.on).map((s) => s.key);
}

/**
 * Is this live section a PREVIEW for the viewer: open to them only because they
 * are a tester (admin or test account), not yet to everyone? Then a small
 * olive "Coming soon" mark sits where it is listed (PreviewPill), so the owner sees what
 * members cannot. `openToEveryone` is the features_open_to_everyone() answer,
 * null until it has loaded and after any failure: then NOTHING is a preview,
 * never a false mark. A member's live section is always open to everyone, so a
 * member never sees the mark. Guard: src/test/previewMark.test.tsx.
 */
export function sectionIsPreview(on: boolean, feature: string, openToEveryone: ReadonlySet<string> | null): boolean {
  return on && openToEveryone !== null && !openToEveryone.has(feature) && !OPEN_FOR_THOSE_WHO_HAVE_IT.has(feature);
}

/**
 * Sections that read as OPEN to everyone who has them, before they open to everyone (owner 2026-10-30, via the
 * lead): the owner and the admins already HAVE Declutter (feature_switch_members; admins pass 'testers'), yet the
 * Explore chip said "Declutter / Soon", the rail "Coming soon" and Browse "Opens soon", because the only live
 * listings were test accounts' (rightly hidden from real accounts). For these, `on` (the same useFeature answer the
 * page's gate reads) is the whole story: no "Soon" or "Coming soon" mark, and Browse's real empty state. A section
 * that is OFF for the viewer still says "Soon" (SoonPill), and Shops and Homes keep the tester mark.
 */
const OPEN_FOR_THOSE_WHO_HAVE_IT: ReadonlySet<string> = new Set(["declutter"]);

/**
 * ONE quiet line for every section not open yet (owner, 2026-10-21: no dead
 * "Opening soon" cards): "Declutter, Shops and Homes are opening soon",
 * "Homes is opening soon"; null when every section is open.
 */
export function openingSoonLine(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const names = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} ${labels.length === 1 ? "is" : "are"} opening soon`;
}

const shownComingSoon = new Set<string>();

/** What a tap on a switched-off section does instead of navigating. */
export function sayComingSoon(label: string) {
  const id = `coming-soon-${label}`;
  shownComingSoon.add(id);
  toast(`${label} is coming soon`, { id });
}

/**
 * A "coming soon" toast belongs to the screen that was tapped (owner,
 * 2026-10-21: "Declutter is coming soon" showed on You › Money with no tap
 * there). It is dismissed the moment the route changes, so it can never be
 * seen on a screen where nobody tapped a section. Called on every pathname
 * change by ScrollToTop (mounted once, app-wide).
 */
export function dismissComingSoonToasts() {
  for (const id of shownComingSoon) toast.dismiss(id);
  shownComingSoon.clear();
}
