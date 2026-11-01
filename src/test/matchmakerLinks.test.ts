/**
 * Matchmaker links (owner-approved growth item, B59, 2026-10-29).
 *
 * Before: answering an "anyone know a handyman?" post meant sending a bare link to the home page; the
 * neighbor then had to find Post a job and type everything. Now Admin -> Growth links builds a
 * /post-job?mm=1&cat=...&t=...&d=...&town=...&zip=...&price=... link: Post a job opens at Details with
 * those fields filled (after signup if needed), every value re-checked on read, and the link has its own
 * preview card (api/share.ts, no database read).
 *
 * @mutate src/lib/matchmakerLink.ts |   if (!isCategory(category)) return null; |   if (!category) return null;
 * @mutate src/lib/matchmakerLink.ts |   if (!Number.isFinite(n) \|\| !Number.isInteger(n) \|\| n < 1 \|\| n > MAX_JOB_BUDGET_DOLLARS) return null; |   if (!Number.isFinite(n)) return null;
 * @mutate src/pages/post-job/useJobFormEffects.ts |     const mm = readMatchmakerLink(searchParams); |     const mm = null as ReturnType<typeof readMatchmakerLink>;
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts | export const PREFILL_OPENS_DETAILS = ["declutterOrder", SELL_FOR_ME_PARAM, MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM, "rebook"] as const; | export const PREFILL_OPENS_DETAILS = ["declutterOrder", SELL_FOR_ME_PARAM, "haulAway", MOVING_DAY_PARAM, "rebook"] as const;
 * @mutate api/share.ts |   if (route.kind === "matchmaker") { |   if (false) {
 * @mutate src/pages/admin/Admin.tsx |       case "growth": return <AdminGrowthLinks />; |
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildMatchmakerLink, readMatchmakerLink, matchmakerSummary } from "@/lib/matchmakerLink";
import { prefillOpensDetails } from "@/pages/post-job/usePrefillOpensDetails";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("building and reading a matchmaker link", () => {
  it("round-trips every field and opens Post a job at Details", () => {
    expect(JOB_CATEGORY_VALUES.length).toBeGreaterThan(10);
    const cat = JOB_CATEGORY_VALUES[0];
    const link = buildMatchmakerLink({ category: cat, title: "Fix a faucet", description: "Kitchen sink drips.", town: "Lafayette", zip: "70501", price: 80 });
    expect(link.startsWith("https://www.louisianahelpr.com/post-job?mm=1&")).toBe(true);
    const params = new URL(link).searchParams;
    expect(readMatchmakerLink(params)).toEqual({ category: cat, title: "Fix a faucet", description: "Kitchen sink drips.", town: "Lafayette", zip: "70501", price: 80 });
    expect(prefillOpensDetails(params)).toBe(true);
    expect(matchmakerSummary({ category: cat, title: "Fix a faucet", town: "Lafayette", price: 80 })).toBe("Fix a faucet in Lafayette · $80");
  });

  it("re-checks a hand-edited link: unknown category refused, bad ZIP and price dropped, text capped", () => {
    expect(readMatchmakerLink(new URLSearchParams("mm=1&cat=not_a_category"))).toBeNull();
    expect(readMatchmakerLink(new URLSearchParams("cat=" + JOB_CATEGORY_VALUES[0]))).toBeNull();
    const r = readMatchmakerLink(new URLSearchParams(`mm=1&cat=${JOB_CATEGORY_VALUES[0]}&zip=12ab5&price=-5&t=${"x".repeat(200)}`));
    expect(r?.zip).toBe("");
    expect(r?.price).toBeNull();
    expect(r?.title.length).toBe(80);
    expect(readMatchmakerLink(new URLSearchParams(`mm=1&cat=${JOB_CATEGORY_VALUES[0]}&price=99999`))?.price).toBeNull();
    // The job cap is the one constant (MAX_JOB_BUDGET_DOLLARS, $1,000): a link never prefills a price Post a job refuses.
    expect(readMatchmakerLink(new URLSearchParams(`mm=1&cat=${JOB_CATEGORY_VALUES[0]}&price=1000`))?.price).toBe(1000);
    expect(readMatchmakerLink(new URLSearchParams(`mm=1&cat=${JOB_CATEGORY_VALUES[0]}&price=1001`))?.price).toBeNull();
    expect(readMatchmakerLink(new URLSearchParams(`mm=1&cat=${JOB_CATEGORY_VALUES[0]}&price=12.5`))?.price).toBeNull();
  });

  it("Post a job fills the form from the link and skips its entry screen", () => {
    const effects = blankComments(read("src/pages/post-job/useJobFormEffects.ts"));
    expect(effects).toContain("const mm = readMatchmakerLink(searchParams);");
    for (const call of ["setCategory(mm.category)", "setTitle(mm.title)", "setZipCode(mm.zip)", "setBudget(String(mm.price))"]) expect(effects).toContain(call);
    expect(blankComments(read("src/pages/post-job/usePostJobForm.ts"))).toContain("searchParams.get(MATCHMAKER_PARAM)");
  });

  it("the admin builder is reachable from Admin", () => {
    const admin = blankComments(read("src/pages/admin/Admin.tsx"));
    expect(admin).toContain('case "growth": return <AdminGrowthLinks />;');
    expect(blankComments(read("src/components/admin/adminNavGroups.tsx"))).toContain('{ id: "growth", label: "Growth links"');
  });
});

describe("the matchmaker link preview (api/share.ts + vercel.json)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("the matchmaker card reads no database");
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("previews the job from the link itself, escaped, noindex", async () => {
    const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=matchmaker&mm=1&cat=handyman&t=Fix%20a%20%22faucet%22&town=Lafayette&price=80`));
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Post this job: Fix a &quot;faucet&quot; in Lafayette · $80"');
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
  });

  it("vercel.json sends /post-job?mm= to the card before the SPA catch-all", () => {
    const v = JSON.parse(read("vercel.json")) as { rewrites: { source: string; destination: string; has?: { type: string; key: string }[] }[] };
    const rw = v.rewrites.find((r) => r.destination === "/api/share?_og=matchmaker");
    expect(rw?.source).toBe("/post-job");
    expect(rw?.has).toContainEqual({ type: "query", key: "mm" });
    expect(v.rewrites.indexOf(rw!)).toBeLessThan(v.rewrites.findIndex((r) => r.destination === "/index.html"));
  });
});
