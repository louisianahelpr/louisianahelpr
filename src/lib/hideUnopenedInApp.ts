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
 * Is a section LISTED for this viewer here? Only once it has LAUNCHED (its switch is on for everyone), on the website
 * AND in the app. M8/M9 (owner 11-16) hid Shops and Homes from members; owner 2026-11-17 (signed-in tweaks, item 1):
 * hide them from admins and testers too ("Coming soon" in the rail, the dock, Home's chips, You's activity tiles and
 * Settings' Your sections) until they launch. `preview` here is "on for this viewer but not (known to be) open to
 * everyone": useSectionTabs passes true until the features_open_to_everyone answer says the section is open, so a
 * tester never sees it pop in and out. When the section's switch goes on for everyone it lists again on its own.
 * `tab` is the section's useSectionTabs row; Jobs has none (no switch).
 * Guard: src/test/closedSectionsHiddenFromMembers.test.tsx.
 */
export function sectionListedHere(tab: { on: boolean; preview: boolean } | undefined): boolean {
  if (!tab) return true;
  if (!tab.on) return false;
  return !tab.preview;
}
