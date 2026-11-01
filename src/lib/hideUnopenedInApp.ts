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
 * Is a section LISTED for this viewer here? Always on the website. In the app only once it is open to
 * them AND not a tester-only preview: the App Review account is a tester, so a preview would still show
 * Apple a "Soon" mark and an empty "Opens soon" Browse. When the section's switch goes on for everyone it
 * lists normally in the app too. `tab` is the section's useSectionTabs row; Jobs has none (no switch).
 */
export function sectionListedHere(tab: { on: boolean; preview: boolean } | undefined): boolean {
  if (!tab || !hideUnopenedInApp()) return true;
  return tab.on && !tab.preview;
}
