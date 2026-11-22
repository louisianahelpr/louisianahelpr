/**
 * Speed 2026-11-20 (owner: pages under 2 s for users). A guest's /sponsor, /25days and every /gift-guides page downloaded
 * ~95 files of signed-in code beside the page: their own shared code (the 25 Days reads, the wish list, the "Hire a
 * Helpr" deep link) is reached by signed-in screens too, so bootReach.mjs files it as signed-in-only and vite.config.ts
 * put it in signed-in-deep / signed-in-pages / signed-in-late, whose static imports are shops, rentals, declutter and
 * job code. Measured on prod (cwv-lab, Slow 4G + 4x, 375, guest): /sponsor's first words at 8.0-8.6 s, a guide's list
 * at 8.1 s; critical-path.mjs on the main build: /gift-guides/:slug 100 chunks / 616 KB gz, /sponsor 92 / 516 KB gz.
 *
 * The class: any shared-code module a public page reaches statically that bootReach calls signed-in-only must be won
 * by the `public-page-reads` group or (11-22) the 25 Days page's own `sponsor-page-reads` group (both ranked above every
 * signed-in group), or be an exact, named one-page exception. critical-path-budget.json's /gift-guides/:slug and
 * /sponsor rows check the built result.
 *
 * Headroom 11-22 (lead: keep /gift-guides/:slug well under its budget without raising it): the 25 Days page's words and
 * reads left public-page-reads for sponsor-page-reads, so a guide page no longer downloads them; the guides' static reach
 * must not touch them (the landing's Facebook link comes from giftGuideConstants.ts).
 *
 * @mutate vite.config.ts |               name: "public-page-reads", |               name: "public-page-reads-off",
 * @mutate vite.config.ts | giftGuideFunApi\|giftWishListApi\|giftNameClean\|retailerCart\|wishLinks)\|content | giftGuideFunApi\|giftWishListApi)\|content
 * @mutate vite.config.ts |               priority: 16.7, |               priority: 14,
 * @mutate src/pages/info/giftGuides/GiftGuideHelpr.tsx | import { Link } from "react-router-dom"; | import { Link } from "react-router-dom"; import "@/lib/matchmakerLink";
 * @mutate src/pages/info/giftGuides/GiftGuideHelpr.tsx | new URLSearchParams({ mm: "1", | new URLSearchParams({ mx: "1",
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx | import { LOUISIANA_HELPR_FACEBOOK } from "@/content/giftGuideConstants"; | import { sponsorPage } from "@/content/sponsorPage"; const LOUISIANA_HELPR_FACEBOOK = sponsorPage.links.facebookPage;
 * @mutate vite.config.ts |               name: "sponsor-page-reads", |               name: "sponsor-page-reads-off",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signedInOnlyModules, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { GIFT_WRAP_JOB_PATH } from "@/pages/info/giftGuides/GiftGuideHelpr";
import { readMatchmakerLink } from "@/lib/matchmakerLink";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
/** The public pages pathPageRoute.ts starts for a guest (the fun gift pages share their code). */
const PUBLIC_PAGE_ROOTS = ["src/pages/info/GiftGuides.tsx", "src/pages/sponsor/SponsorPage.tsx"];
/**
 * Signed-in-only by bootReach but imported by ONE chunk of these pages, so no signed-in group (each needs two
 * importers, minShareCount 2) takes it: it rides in its page's own chunk. Exact both ways.
 */
const ONE_PAGE_ONLY = ["src/lib/giftGuidePageMeta.mjs"];

const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
const groupOf = (name: string) => config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0] ?? "";
const priorityOf = (name: string) => Number(groupOf(name).match(/priority:\s*([\d.]+)/)?.[1] ?? NaN);

describe("the public pages carry no signed-in chunk (speed 11-20)", () => {
  const reach = [...staticReach(ROOT, PUBLIC_PAGE_ROOTS.map((r) => resolve(ROOT, r)))].map(rel);
  const { signedInOnly } = signedInOnlyModules(ROOT);
  const signedInReached = reach.filter((f) => signedInOnly.has(resolve(ROOT, f).split("\\").join("/")));
  const group = groupOf("public-page-reads");
  const test = new RegExp(group.match(/test:\s*\/(.*)\/,\s*\n/)?.[1] ?? "^$");
  const sponsorGroup = groupOf("sponsor-page-reads");
  const sponsorTest = new RegExp(sponsorGroup.match(/test:\s*\/(.*)\/,\s*\n/)?.[1] ?? "^$");
  const won = (f: string) => test.test(`/x/${f}`) || sponsorTest.test(`/x/${f}`);

  it("walks the real pages (floor: the pages, their reads and the deep link are reached)", () => {
    expect(reach.length).toBeGreaterThan(100);
    for (const f of ["src/pages/sponsor/SponsorPage.tsx", "src/pages/info/giftGuides/GiftGuideHelpr.tsx", "src/lib/sponsor/api.ts", "src/lib/giftWishListApi.ts"]) {
      expect(reach, f).toContain(f);
    }
    expect(signedInReached.length).toBeGreaterThan(4);
  });

  it("every signed-in-only module they reach is won by public-page-reads or sponsor-page-reads, or is a named one-page exception", () => {
    expect(group, "the public-page-reads group exists").not.toBe("");
    expect(sponsorGroup, "the sponsor-page-reads group exists").not.toBe("");
    const loose = signedInReached.filter((f) => !won(f) && !ONE_PAGE_ONLY.includes(f));
    expect(loose).toEqual([]);
    // Two-way: each exception is still reached and still signed-in-only, and the group's test is not dead.
    for (const f of ONE_PAGE_ONLY) expect(signedInReached, f).toContain(f);
    expect(signedInReached.filter((f) => test.test(`/x/${f}`)).length).toBeGreaterThan(3);
  });

  it("public-page-reads and sponsor-page-reads rank above every signed-in group, so they win those modules", () => {
    const top = Math.max(...["signed-in-deep", "signed-in-pages", "signed-in-late", "signed-in-shared", "signed-in-chrome"].map(priorityOf));
    expect(Number.isFinite(top)).toBe(true);
    expect(priorityOf("public-page-reads")).toBeGreaterThan(top);
    expect(priorityOf("sponsor-page-reads")).toBeGreaterThan(top);
    expect(group).toMatch(/includeDependenciesRecursively:\s*false/);
    expect(sponsorGroup).toMatch(/includeDependenciesRecursively:\s*false/);
  });

  it("a gift guide page reaches none of the 25 Days page's words or reads, and they sit in their own group (headroom 11-22)", () => {
    const guides = [...staticReach(ROOT, [resolve(ROOT, "src/pages/info/GiftGuides.tsx")])].map(rel);
    expect(guides.length).toBeGreaterThan(100);
    const SPONSOR_READS = ["src/content/sponsorPage.ts", "src/lib/sponsor/api.ts", "src/lib/sponsor/dates.ts", "src/lib/sponsor/placeholders.ts"];
    for (const f of SPONSOR_READS) {
      expect(guides, f).not.toContain(f);
      expect(reach, `${f} is still the 25 Days page's`).toContain(f);
      expect(sponsorTest.test(`/x/${f}`), f).toBe(true);
      expect(test.test(`/x/${f}`), `${f} left public-page-reads`).toBe(false);
    }
  });

  it("the share sheet and the matchmaker link stay off their static reach (their chunks are signed-in code)", () => {
    expect(reach).not.toContain("src/lib/nativeShare.ts");
    expect(reach).not.toContain("src/lib/matchmakerLink.ts");
  });

  it("the gift-wrap job link, written out without matchmakerLink.ts, still reads back as a matchmaker link", () => {
    const fields = readMatchmakerLink(new URL(GIFT_WRAP_JOB_PATH, "https://x").searchParams);
    expect(fields).toMatchObject({ category: "errands", title: "Gift wrapping" });
  });
});
