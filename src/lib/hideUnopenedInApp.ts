import { isNativePlatform } from "@/lib/nativeInit";

/**
 * NOTHING "COMING SOON" IN THE iPHONE APP (owner, 2026-10-31 ~9:15 PM, App Store submission pop-up):
 * "In the iPhone app (native), HIDE closed sections (Shops, Homes) and the two disabled quote buttons
 * (Get quotes on Post a job; Request a quote in Sell it for me) until they open. The website keeps
 * showing them." Apple rejects a build that shows unfinished features or "coming soon" placeholders
 * (App Review 2.1 / 2.2; appstore-readiness-1031.md #1).
 *
 * The store build answers true, the website false, whatever a switch says: where the app is installed
 * is a genuine native capability, like MEMBERSHIPS_HIDDEN_IN_THIS_APP (src/hooks/useMembershipsOn.ts).
 * Read at call time, so a test's vi.mock of "@/lib/nativeInit" is seen.
 *
 * Every place that shows a closed section or a disabled quote button reads THIS helper.
 * Guard: src/test/nothingComingSoonInTheApp.test.tsx.
 */
export function hideUnopenedInApp(): boolean {
  return isNativePlatform;
}

/**
 * Is a section LISTED for this viewer here? Only once its switch is on for them, on the website AND in the app
 * (M8/M9, owner 11-16: "hide Shops and Homes from members everywhere (Home, the tab bar, Create, Customize,
 * Settings) until they launch"; this replaces the website's greyed "Soon" rows). Admins and testers, for whom the
 * switch is on, keep them on the website. In the app a tester-only preview is still not listed: the App Review
 * account is a tester, so a preview would show Apple a "Soon" mark and an empty "Opens soon" Browse. When the
 * section's switch goes on for everyone it lists normally. `tab` is the section's useSectionTabs row; Jobs has none
 * (no switch). Guard: src/test/closedSectionsHiddenFromMembers.test.tsx.
 */
export function sectionListedHere(tab: { on: boolean; preview: boolean } | undefined): boolean {
  if (!tab) return true;
  if (!tab.on) return false;
  return !hideUnopenedInApp() || !tab.preview;
}
