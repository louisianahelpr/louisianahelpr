/**
 * Every screen that renders the shared section tab row (<SectionTabs>), with the route that opens it.
 * Kept equal to the source by src/test/sectionTabsStayPutCovers.test.tsx: a new <SectionTabs> screen fails there until
 * it is listed here, so e2e/a11y-prod/sectionTabsStayPut.spec.ts checks it scrolled.
 */
/** `desktopOnly`: the tab row is the desktop website's only (Declutter's phone header has none since the Vinted
 *  header, owner 11-08: its lists open from the photo's "My Declutter"; src/test/declutterHeaderVinted.test.tsx). */
export const SECTION_TAB_SCREENS: readonly { name: string; file: string; path: string; desktopOnly?: boolean }[] = [
  { name: "Jobs", file: "src/pages/jobs/JobsSection.tsx", path: "/jobs" },
  { name: "Declutter", file: "src/components/declutter/DeclutterHomeView.tsx", path: "/declutter", desktopOnly: true },
  { name: "Shops", file: "src/components/shops/ShopsHomeView.tsx", path: "/shops" },
  { name: "Homes", file: "src/components/rentals/RentalsHomeView.tsx", path: "/rentals" },
];
