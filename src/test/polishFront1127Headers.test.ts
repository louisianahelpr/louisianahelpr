/**
 * Polish audit 11-27 #7 (owner phone polish audit): a signed-out phone stacked two header rows on Jobs and Declutter
 * (the site bar, then the title row, then a "Jobs | Declutter" chip row; Declutter also had "+ Sell" on that chip row).
 * On the web the site bar already carries the Jobs, Declutter and Gifts icons, so the chip row is gone there; Declutter's
 * "+ Sell" sits in the title row beside search and Filters. The app's guest screens (no site bar) keep the switch. The
 * back arrows stay: the owner asked for them on 11-21 ("needs a back button to the left of browse jobs").
 * (Guides pages: src/test/guidesPhonePolish1125.test.tsx.)
 *
 * @mutate src/pages/home/DashboardGuest.tsx |     {isNativePlatform && <GuestSectionSwitch at="jobs" className="mb-2" />} |     <GuestSectionSwitch at="jobs" className="mb-2" />
 * @mutate src/components/declutter/DeclutterGuestHome.tsx |     tabs: siteBar ? undefined : | tabs: false ? undefined :
 * @mutate src/components/declutter/DeclutterGuestHome.tsx | search: siteBar ? <div | search: false ? <div
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("one header row on a signed-out phone (polish audit 11-27 #7)", () => {
  it("guest Jobs on the web draws no Jobs | Declutter chips (the site bar has both); the app keeps them", () => {
    const s = src("src/pages/home/DashboardGuest.tsx");
    const uses = s.match(/<GuestSectionSwitch\b[^>]*\/>/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(s).toContain('{isNativePlatform && <GuestSectionSwitch at="jobs" className="mb-2" />}');
  });

  it("guest Declutter on the web: no chip row, '+ Sell' in the title row; the app keeps the switch row", () => {
    const s = src("src/components/declutter/DeclutterGuestHome.tsx");
    expect(s).toContain("const siteBar = useGuestPublicFrame();");
    expect(s).toMatch(/search: siteBar \? <div className="flex min-w-0 items-center justify-end" data-guest-title-row-sell="">\{browse\.search\}\{titleRowSell\}<\/div> : browse\.search,/);
    // A text button, not a pill (a pill cut the title to "Declu…" at 375).
    expect(s).toMatch(/const titleRowSell = \(\s*<Link to=\{SELL_START_PATH\} data-guest-sell="" className="inline-flex min-h-11 shrink-0 items-center px-2 text-ds-15 font-semibold/);
    expect(s).toMatch(/tabs: siteBar \? undefined : <div[^\n]*<GuestSectionSwitch at="declutter"/);
  });
});
