/**
 * Phone polish, part C (owner 11-25: "We need to polish the signed out and in version on phones"; audit
 * ~/.lh-shots/phone-polish-audit-1125/FINDINGS.md, MEDIUM findings). One guard per shared fix:
 *   #37 a dialog/sheet scrim on a phone is a plain dim, no blur (desktop keeps its tint + blur);
 *   #32 the bottom tab bar is 96% white under a 12px blur (was 40% white, muddy over the page);
 *   #30 every Settings switch row is vertically centred (search-engines sat top-aligned);
 *   #17 Home rows show a bare section icon, no grey circle (owner 11-17: icon-in-circle rows are an AI tell);
 *   #14 one section label on Home: 12px / 600 / 0.08em, the same as Needs you and Settings;
 *   #13 one missing-photo look: the category placeholder under the item page photo and Home's For sale tiles;
 *   #18 prices are dark ink (job page 24px) on the job page, Posted rows, the job sheet take-home and the chat job card;
 *   job meta at 375: a member's row moves "Flexible" to a small tag on the poster line (it cut "1 PM · Flexib");
 *   Declutter Browse's round + sits 6px from the edge (it covered the right card's "incl. fee" line at rest).
 *
 * @mutate src/components/ui/dialog.tsx | "phone-scrim fixed inset-0 z-50 | "fixed inset-0 z-50
 * @mutate src/index.css |   --nav-pill-bg:       hsla(0, 0%, 100%, 0.96); |   --nav-pill-bg:       hsla(0, 0%, 100%, 0.40);
 * @mutate src/components/profile/ShowInSearchSwitch.tsx | <div className="flex items-center gap-3" data-testid="show-in-search"> | <div className="flex items-start gap-3" data-testid="show-in-search">
 * @mutate src/pages/home/homeDashboard/homeFirstExtras.tsx | <span aria-hidden title={label} className="w-6 h-6 shrink-0 flex items-center justify-center"> | <span aria-hidden title={label} className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-muted">
 * @mutate src/pages/home/homeDashboard/HelprsNearYou.tsx | text-ds-12 font-semibold uppercase tracking-[0.08em] | text-ds-13 font-bold uppercase tracking-[0.06em]
 * @mutate src/pages/home/homeDashboard/ForSaleNearYou.tsx | <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" /> | <span />
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | const MONEY = "text-[hsl(var(--ink-deep))]"; | const MONEY = "text-[hsl(var(--burnt-sienna))]";
 * @mutate src/components/job-card/MineJobFace.tsx | tabular-nums text-[hsl(var(--ink-deep))]"> | tabular-nums text-[hsl(var(--accent-ink))]">
 * @mutate src/components/dashboard/JobCard.tsx |               flexibleTag={flexibleOnPosterLine} |               flexibleTag={false}
 * @mutate src/components/declutter/DeclutterItemView.tsx | <Share2 className="!h-[22px] !w-[22px]" aria-hidden /> | <Share2 className="w-5 h-5" aria-hidden />
 * @mutate src/components/sections/SectionCreateFab.tsx | const FAB_ROUND_RIGHT = "right-1.5"; | const FAB_ROUND_RIGHT = "right-4";
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { JobCardPosterFace } from "@/components/dashboard/JobCardMedia";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const css = () => blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

describe("phone polish C (11-25)", () => {
  it("#37: dialog and sheet scrims carry phone-scrim, a plain dim with no blur below 768px", () => {
    for (const f of ["src/components/ui/dialog.tsx", "src/components/ui/sheet.tsx"]) {
      expect(src(f), f).toMatch(/"phone-scrim fixed inset-0 z-50/);
    }
    const block = /@media \(max-width: 767px\) \{\s*\.phone-scrim \{([^}]*)\}/.exec(css())?.[1] ?? "";
    expect(block.length).toBeGreaterThan(40);
    expect(block).toMatch(/backdrop-filter: none !important/);
    expect(block).toMatch(/background-color: hsl\(0 0% 0% \/ 0\.28\) !important/);
  });

  it("#32: the tab bar is 96% white (light) under a 12px blur", () => {
    expect(css()).toContain("--nav-pill-bg:       hsla(0, 0%, 100%, 0.96);");
    const nav = src("src/components/MobileNav.tsx");
    expect(nav).toContain('backdropFilter: "blur(12px) saturate(180%)"');
    expect(nav).not.toContain('backdropFilter: "blur(40px) saturate(180%)"');
  });

  it("#30: the search-engines switch row is centred like every Settings switch", () => {
    expect(src("src/components/profile/ShowInSearchSwitch.tsx")).toContain('<div className="flex items-center gap-3" data-testid="show-in-search">');
  });

  it("#17: Home rows draw a bare 20px section icon, never a grey circle", () => {
    const files = ["src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/homeFirstExtras.tsx", "src/pages/home/homeDashboard/HomeMoreRows.tsx"];
    for (const f of files) expect(src(f), f).toContain("w-6 h-6 shrink-0 flex items-center justify-center");
    expect(src("src/pages/home/HomeDashboard.tsx")).not.toMatch(/data-coming-up-section=\{c\.section\} className="[^"]*rounded-full/);
    expect(src("src/pages/home/homeDashboard/homeFirstExtras.tsx")).not.toMatch(/title=\{label\} className="[^"]*rounded-full[^"]*bg-muted/);
    expect(src("src/pages/home/homeDashboard/HomeMoreRows.tsx")).toMatch(/data-home-active-kind=\{r\.kind\} className=\{ICON_LEAD\}/);
  });

  it("#14: every Home section label is 12px / 600 / 0.08em", () => {
    const LABEL = "text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground";
    const files = ["src/components/sections/StatusBoxes.tsx", "src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/HelprsNearYou.tsx", "src/pages/home/homeDashboard/ForSaleNearYou.tsx", "src/components/job-card/ActivityBucketGroups.tsx"];
    let n = 0;
    for (const f of files) {
      const s = src(f);
      expect(s, f).not.toContain("uppercase tracking-[0.06em]");
      n += s.split(LABEL).length - 1;
    }
    expect(n).toBeGreaterThan(4);
  });

  it("#13: the item photo and Home's For sale tiles stand on the category placeholder", () => {
    const fs = src("src/pages/home/homeDashboard/ForSaleNearYou.tsx");
    expect(fs).toContain('<PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" />');
    const g = src("src/components/declutter/DeclutterGallery.tsx");
    expect(g).toMatch(/className="absolute inset-0 h-full w-full sm:hidden" \/>/);
    expect(g).toMatch(/fallback=\{<PhotoPlaceholder /);
  });

  it("#18: the job page, Posted, the job sheet take-home and the chat job card are dark ink", () => {
    const RUST = /accent-ink|burnt-sienna/;
    const mine = src("src/components/job-card/MineJobFace.tsx");
    const money = mine.slice(mine.indexOf('data-mine-face-money=""'), mine.indexOf("{money}", mine.indexOf('data-mine-face-money=""')));
    expect(money.length).toBeGreaterThan(40);
    expect(money).not.toMatch(RUST);
    const deal = src("src/components/messages/chatView/DealCard.tsx");
    expect(deal.split('style={{ color: "hsl(var(--ink-deep))" }}>').length - 1).toBeGreaterThanOrEqual(2);
    expect(deal).not.toMatch(/tabular-nums" style=\{\{ color: "hsl\(var\(--burnt-sienna\)\)" \}\}/);
    const take = src("src/components/dashboard/helprTakeHome.tsx");
    expect(take).toContain("text-ds-24 font-bold leading-none tabular-nums text-[hsl(var(--ink-deep))]");
    const page = src("src/pages/jobs/jobPage/JobPageParts.tsx");
    expect(page).toContain('const MONEY = "text-[hsl(var(--ink-deep))]";');
    expect(page.split("text-ds-24 font-bold tabular-nums leading-none ${MONEY}").length - 1).toBe(2);
    // Home's money tiles stay rust: owner-approved boards 7 and 11 (src/test/homeMoneyTiles.test.tsx).
  });

  it("job meta: a member's row keeps ONE line and shows Flexible as a tag on the poster line", () => {
    const card = src("src/components/dashboard/JobCard.tsx");
    expect(card).toContain("flexibleTag={flexibleOnPosterLine}");
    expect(card).toMatch(/const flexibleOnPosterLine = row && !isGuest && !!timeLabel/);
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <JobCardPosterFace posterId="u1" name="Lexi Smith" avatarUrl={null} avgRating={5} reviewCount={3} flexibleTag />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Flexible time")).toBeTruthy();
    expect(screen.getByText("Lexi")).toBeTruthy();
  });

  it("#12: the item page heart and share are plain icons, no bordered circle", () => {
    const v = src("src/components/declutter/DeclutterItemView.tsx");
    const at = v.indexOf('data-item-save-share=""');
    const block = v.slice(at, v.indexOf("</div>", at));
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/border border-border bg-card/);
    expect(block.split("!h-[22px] !w-[22px]").length - 1).toBe(2);
  });

  it("Declutter Browse's round + sits 6px from the edge; the pill keeps 16px", () => {
    const fab = src("src/components/sections/SectionCreateFab.tsx");
    expect(fab).toContain('const FAB_ROUND_RIGHT = "right-1.5";');
    expect(fab).toContain('${round ? FAB_ROUND_RIGHT : "right-4"}');
  });
});
