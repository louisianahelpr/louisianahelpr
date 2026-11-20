/**
 * Every screen that renders the shared section tab row (<SectionTabs>), with the route that opens it.
 * Kept equal to the source by src/test/sectionTabsStayPutCovers.test.tsx: a new <SectionTabs> screen fails there until
 * it is listed here, so e2e/a11y-prod/sectionTabsStayPut.spec.ts checks it scrolled.
 */
/** `desktopOnly`: the tab row is the desktop website's only. Since the Vinted header (owner 11-08) no phone section
 *  header draws one: each section's lists open from the photo's "My …" sheet (src/test/declutterHeaderVinted.test.tsx,
 *  src/test/jobsSectionTabs.test.tsx).
 *  `guest`: the screen is a signed-out visitor's, so it is opened with no session. DeclutterGuestHome (BUY-16) left the list
 *  on 11-20 (site polish A3): a guest's desktop row is a plain item count, not a <SectionTabs>. */
export const SECTION_TAB_SCREENS: readonly { name: string; file: string; path: string; desktopOnly?: boolean; guest?: boolean }[] = [
  { name: "Jobs", file: "src/pages/jobs/JobsSection.tsx", path: "/jobs", desktopOnly: true },
  { name: "Declutter", file: "src/components/declutter/DeclutterHomeView.tsx", path: "/declutter", desktopOnly: true },
  { name: "Shops", file: "src/components/shops/ShopsHomeView.tsx", path: "/shops", desktopOnly: true },
  { name: "Homes", file: "src/components/rentals/RentalsHomeView.tsx", path: "/rentals", desktopOnly: true },
];
