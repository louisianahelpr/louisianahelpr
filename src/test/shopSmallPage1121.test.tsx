/**
 * Shop Small Louisiana, /shop-small (owner 2026-11-21: "add the feature that small business can sign their business up
 * to be featured on the site").
 *
 * The feature already existed (owner 2026-11-20: free "Featured local" listings, a signed-out form, admin approval in
 * /admin/sponsors; migration 20261120152039_sbs_featured_local, edge function sbs-featured), but its only home was
 * /gift-guides/small-business-saturday, which the 11-21 "only three guides" change retired. Nobody could reach the form,
 * so the owner asked for it again.
 *
 * The CLASS guard: a form that lives only on a gift guide page the live list can retire. It reads those pages from
 * GiftGuides.tsx itself (each `slug === <SLUG> && isLiveGuide(<SLUG>)` gate, and since the deals days (owner 11-21,
 * one page per day) each `slug && isLiveGuide(slug) ? <lookup>(slug)` gate, and the component only that gate renders),
 * walks the import graph from App.tsx WITHOUT entering those pages, and requires every module with a form (`<form` or
 * `onSubmit=`) that such a page reaches to also be reachable that way, live or retired today (a page the owner turns off
 * must never take a form with it). It was red on main before /shop-small: SmallBizSubmitForm was reached only through
 * GiftGuideSmallBiz -> SmallBizLocal.
 *
 * Then: the page itself (approved listings with no email, the sign-up card, works signed out), and every place a new
 * public page must be registered (route, head, pre-JS body, both rewrites, sitemap) plus its link from the Holiday Hub.
 *
 * @mutate src/pages/info/GiftGuides.tsx |   const deals = slug && isLiveGuide(slug) ? dealDay(slug) : null; |   const deals = slug ? dealDay(slug) : null;
 * @mutate src/pages/info/ShopSmall.tsx |           <SmallBizLocal sponsors={[]} heading={{ title: W.pageSectionTitle, intro: W.pageSectionIntro }} /> |           {null}
 * @mutate src/App.tsx |       <Route path="/shop-small" element= |       <Route path="/shop-small-old" element=
 * @mutate src/pages/info/holidays/HolidayHub.tsx |           <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard inline-flex min-h-11 items-center"> |           <Link to="/gift-guides" className="link-standard inline-flex min-h-11 items-center">
 * @mutate src/pages/info/giftGuides/SmallBizLocal.tsx | <h2 id={SBS_LOCAL_HEAD}>{heading?.title ?? W.sectionTitle} | <h2 id={SBS_LOCAL_HEAD}>{W.sectionTitle}
 * (Moved here from giftWishList1120.test.tsx, whose colour test was removed 11-21 and so no longer killed it:)
 * @mutate src/pages/info/giftGuides/smallBizCardStyles.ts | border-radius:14px;background:hsl(var(--card));color:var(--gg-ink)} | border-radius:14px;background:#fff}
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  // The shell draws no header row when the page draws its own (hideHeader; /shop-small sits in the guides' frame since
  // holiday audit 1121 #73).
  PublicHeaderPage: ({ children, title, hideHeader }: { children: React.ReactNode; title: string; hideHeader?: boolean }) => <main>{hideHeader ? null : <h1>{title}</h1>}{children}</main>,
}));
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: vi.fn(async () => [
    { id: "11111111-1111-4111-8111-111111111111", name: "Bayou Candle Co", town: "Breaux Bridge", category: "Home & Decor", link: "https://example.com/", deal: "20% off Saturday", has_logo: false },
  ]),
  sbsLogoUrl: (id: string) => `https://x.invalid/logo?${id}`,
  sbsDeviceId: () => "test-device-0001",
  submitFeaturedLocal: vi.fn(async () => ({ ok: true })),
}));

import ShopSmall from "@/pages/info/ShopSmall";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { infoPageBody } from "@/lib/seoBodies.mjs";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

afterEach(() => cleanup());

// ── The import graph ───────────────────────────────────────────────────────────────────────────────────────────────
const EXTS = ["", ".tsx", ".ts", ".mjs", ".js", "/index.tsx", "/index.ts"];
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && /\.(tsx?|mjs|js)$/.test(p)) return p;
  }
  return null;
}
const codeCache = new Map<string, string>();
const code = (file: string) => {
  if (!codeCache.has(file)) codeCache.set(file, blankComments(readFileSync(file, "utf8")));
  return codeCache.get(file)!;
};
function importsOf(file: string): string[] {
  const src = code(file);
  const specs = [
    ...[...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
  ];
  return specs.map((s) => resolveImport(file, s)).filter((p): p is string => !!p && p.startsWith(SRC));
}
function reachable(roots: string[], skip: Set<string>): Set<string> {
  const seen = new Set<string>();
  const stack = roots.filter((r) => !skip.has(r));
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const n of importsOf(f)) if (!seen.has(n) && !skip.has(n)) stack.push(n);
  }
  return seen;
}
const hasForm = (file: string) => /\.tsx$/.test(file) && /<form\b|\bonSubmit=/.test(code(file));

/**
 * The gift guide pages the live list gates (src/content/giftGuideLive.mjs): each slug gate in GiftGuides.tsx and the file
 * of every component only that gate renders. `live` says whether the gate's page is on today.
 */
async function gatedPages(): Promise<{ slug: string; file: string; live: boolean }[]> {
  const pageFile = resolve(SRC, "pages/info/GiftGuides.tsx");
  const src = code(pageFile);
  const importOf = (name: string) => [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].find((i) => i[1].split(",").map((x) => x.trim()).includes(name));
  // Every component a gate renders (`<gate> ? <Component`) that nothing else in the page renders.
  const onlyUnder = (gateVar: string) => {
    const comps = [...new Set([...src.matchAll(new RegExp(`\\b${gateVar}\\s*\\?\\s*\\(?\\s*<(\\w+)`, "g"))].map((c) => c[1]))];
    return comps.filter((comp) => (src.match(new RegExp(`<${comp}\\b`, "g")) ?? []).length === (src.match(new RegExp(`\\b${gateVar}\\s*\\?\\s*\\(?\\s*<${comp}\\b`, "g")) ?? []).length);
  };
  const fileOf = (comp: string) => {
    const compImp = importOf(comp);
    if (compImp) return resolveImport(pageFile, compImp[2])!;
    // A lazy part (train 1121i: LazyDeals): the page's own wrapper loads the component's module through
    // useLazyPart(<loader>), and the loader is `const <loader> = () => loadModule(() => import("<module>"))`.
    const body = src.match(new RegExp(`function\\s+${comp}\\b[\\s\\S]*?\\n}`))?.[0] ?? "";
    const loader = body.match(/useLazyPart\(\s*(\w+)/)?.[1];
    const spec = loader ? src.match(new RegExp(`const\\s+${loader}\\s*=\\s*\\(\\)\\s*=>\\s*loadModule\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*["']([^"']+)["']`))?.[1] : undefined;
    if (!spec) throw new Error(`GiftGuides.tsx: no import for ${comp}`);
    return resolveImport(pageFile, spec)!;
  };
  const out: { slug: string; file: string; live: boolean }[] = [];
  // One page per slug constant: `const smallBiz = slug === SMALL_BIZ_SLUG && isLiveGuide(SMALL_BIZ_SLUG)`.
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\(?\s*slug\s*===\s*(\w+)\s*&&\s*isLiveGuide\(\s*\2\s*\)/g)) {
    const [, gateVar, constName] = m;
    const imp = importOf(constName);
    if (!imp) throw new Error(`GiftGuides.tsx: no import for ${constName}`);
    const mod = (await import(/* @vite-ignore */ resolveImport(pageFile, imp[2])!)) as Record<string, unknown>;
    const slug = String(mod[constName]);
    const comps = onlyUnder(gateVar);
    if (comps.length === 0) throw new Error(`GiftGuides.tsx: gate ${gateVar} renders no component of its own`);
    for (const comp of comps) out.push({ slug, file: fileOf(comp), live: isLiveGuide(slug) });
  }
  // A family of pages by lookup: `const deals = slug && isLiveGuide(slug) ? dealDay(slug) : null` (the deals days).
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*slug\s*&&\s*isLiveGuide\(\s*slug\s*\)\s*\?\s*(\w+)\(\s*slug\s*\)/g)) {
    const [, gateVar, lookup] = m;
    const imp = importOf(lookup);
    if (!imp) throw new Error(`GiftGuides.tsx: no import for ${lookup}`);
    const mod = (await import(/* @vite-ignore */ resolveImport(pageFile, imp[2])!)) as Record<string, unknown>;
    const slugs = (mod.DEAL_DAY_SLUGS as string[] | undefined) ?? [];
    if (slugs.length === 0) throw new Error(`GiftGuides.tsx: gate ${gateVar} looks up no known slug list`);
    const comps = onlyUnder(gateVar);
    if (comps.length === 0) throw new Error(`GiftGuides.tsx: gate ${gateVar} renders no component of its own`);
    for (const slug of slugs) for (const comp of comps) out.push({ slug, file: fileOf(comp), live: isLiveGuide(slug) });
  }
  return out;
}

describe("a form never lives only on a retired gift guide page (class guard)", () => {
  it("every form a gated (retirable) page reaches is also reachable from App.tsx without it", async () => {
    const gated = await gatedPages();
    // Inventory floor: the gates exist (the three deals days today, owner 11-21: one page per day, all live).
    expect(gated.length).toBeGreaterThan(2);
    expect(gated.map((g) => g.file.slice(SRC.length + 1))).toContain("pages/info/giftGuides/GiftGuideDeals.tsx");
    const skip = new Set(gated.map((r) => r.file));
    const live = reachable([resolve(SRC, "App.tsx")], skip);
    expect(live.size).toBeGreaterThan(100);
    const behind = reachable([...skip], new Set());
    // Inventory floor: the walk enters the gated pages (GiftGuideDeals and what it imports). Today none of them reaches a
    // form (the sign-up form left with the old standalone Small Business Saturday page; it lives on /shop-small).
    expect(behind.size).toBeGreaterThan(5);
    const formsBehindRetired = [...behind].filter(hasForm);
    const stranded = formsBehindRetired.filter((f) => !live.has(f)).map((f) => f.slice(ROOT.length + 1));
    // Guides audit 1122 #7 (owner 11-21: "remove Shop Small, it is already listed with Small Business Saturday"): the free
    // sign-up form now lives only on the Small Business Saturday day page, a live deals day. One named exemption, nothing
    // else: if that day is ever retired, /shop-small and the form must come back (see the redirect in App.tsx).
    const OWNER_DECIDED_ON_SBS_DAY = ["src/pages/info/giftGuides/SmallBizSubmitForm.tsx"];
    expect(isLiveGuide("small-business-saturday")).toBe(true);
    expect(stranded.filter((f) => !OWNER_DECIDED_ON_SBS_DAY.includes(f)), "a form reachable only through a retired guide page: give it a live page").toEqual([]);
  });
});

describe("/shop-small, the page", () => {
  it("shows the approved listings (never an email) and the sign-up card, signed out", async () => {
    render(<MemoryRouter initialEntries={["/shop-small"]}><ShopSmall /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: SBS_WORDS.pageTitle })).toBeTruthy();
    expect(await screen.findByText("Bayou Candle Co")).toBeTruthy();
    expect(screen.getByRole("heading", { name: new RegExp(SBS_WORDS.pageSectionTitle) })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    const open = screen.getByRole("button", { name: SBS_WORDS.ctaButton });
    fireEvent.click(open);
    // The form chunk opens in place: its business name field and the private-email hint.
    expect(await screen.findByLabelText(new RegExp(SBS_WORDS.fields.businessName), {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(SBS_WORDS.fields.emailHint)).toBeTruthy();
  });

  // Holiday audit 1121 area 5 #4: with 0 approved listings (sbs_public_featured held 0 rows on 2026-11-21) or a failed
  // read, the free listings said nothing at all; they now say so (the sponsors still lead the page, batch 5 #61).
  // @mutate src/pages/info/giftGuides/SmallBizLocal.tsx |   const stateLine = !heading \|\| list.length > 0 ? null | const stateLine = true ? null
  it("says when there are no free listings yet, or when they did not load, and the sponsors still lead", async () => {
    const api = await import("@/lib/sbsFeaturedApi");
    vi.mocked(api.listFeaturedLocal).mockResolvedValueOnce([]);
    const empty = render(<MemoryRouter initialEntries={["/shop-small"]}><ShopSmall /></MemoryRouter>);
    expect(empty.container.querySelector("[data-shop-small-sponsors]")).not.toBeNull();
    const line = await screen.findByText((_, el) => el?.getAttribute("data-gift-sbs-local-state") === "empty");
    expect([SBS_WORDS.localEmptyBefore, SBS_WORDS.localEmptyAfter]).toContain(line.textContent);
    cleanup();
    vi.mocked(api.listFeaturedLocal).mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter initialEntries={["/shop-small"]}><ShopSmall /></MemoryRouter>);
    expect((await screen.findByRole("alert")).textContent).toBe(SBS_WORDS.localFailed);
  });
});

describe("the small business card follows the theme", () => {
  it("the card and its text take the app's card and ink colours (dark mode), never a hard white", () => {
    const card = /(?:^|\n)\.gg-sb\{([^}]*)\}/.exec(blankComments(read("src/pages/info/giftGuides/smallBizCardStyles.ts")))?.[1];
    expect(card).toBeDefined();
    expect(card).toContain("background:hsl(var(--card))");
    expect(card).toContain("color:var(--gg-ink)");
  });
});

describe("/shop-small is registered everywhere a public page must be", () => {
  it("route, head, pre-JS body, both rewrites, sitemap, shell lists and the Holiday Hub link", () => {
    expect(blankComments(read("src/App.tsx"))).toMatch(/<Route path="\/shop-small" element=\{<Navigate to="\/gift-guides\/small-business-saturday" replace \/>/);
    expect(PUBLIC_PAGE_META["/shop-small"].canonical).toMatch(/\/shop-small$/);
    expect(infoPageBody("/shop-small")).toContain("Shop Small Louisiana");
    const rewrites = (JSON.parse(read("vercel.json")) as { rewrites: { source: string; destination: string }[] }).rewrites.filter((r) => r.source === "/shop-small");
    expect(rewrites.map((r) => r.destination)).toEqual(["/api/share?_og=page&_id=shop-small", "/index.html"]);
    // Guides audit 1122 #7: the route is a redirect to Small Business Saturday, so it is no sitemap entry.
    expect(read("public/sitemap.xml")).not.toContain("<loc>https://www.louisianahelpr.com/shop-small</loc>");
    expect(blankComments(read("src/App.tsx"))).toContain('<Navigate to="/gift-guides/small-business-saturday" replace />');
    expect(blankComments(read("src/hooks/useAppShellViewport.ts")).match(/"\/shop-small"/g)?.length).toBe(2);
    expect(blankComments(read("src/pages/info/holidays/HolidayHub.tsx"))).toMatch(/<Link to="\/gift-guides\/small-business-saturday#get-featured"/);
  });
});
