/**
 * Shop Small Louisiana, /shop-small (owner 2026-11-21: "add the feature that small business can sign their business up
 * to be featured on the site").
 *
 * The feature already existed (owner 2026-11-20: free "Featured local" listings, a signed-out form, admin approval in
 * /admin/sponsors; migration 20261120152039_sbs_featured_local, edge function sbs-featured), but its only home was
 * /gift-guides/small-business-saturday, which the 11-21 "only three guides" change retired. Nobody could reach the form,
 * so the owner asked for it again.
 *
 * The CLASS guard: a form that lives only on a retired gift guide page. It reads the retired pages from GiftGuides.tsx
 * itself (each `slug === <SLUG> && isLiveGuide(<SLUG>)` gate whose slug is not live, and the component that gate
 * renders), walks the import graph from App.tsx WITHOUT entering those pages, and requires every module with a form
 * (`<form` or `onSubmit=`) that a retired page reaches to also be reachable that way. It was red on main before
 * /shop-small: SmallBizSubmitForm was reached only through GiftGuideSmallBiz -> SmallBizLocal.
 *
 * Then: the page itself (approved listings with no email, the sign-up card, works signed out), and every place a new
 * public page must be registered (route, head, pre-JS body, both rewrites, sitemap) plus its link from the Holiday Hub.
 *
 * @mutate src/pages/info/ShopSmall.tsx |         <SmallBizLocal sponsors={[]} heading={{ title: W.pageSectionTitle, intro: W.pageSectionIntro }} /> |         {null}
 * @mutate src/App.tsx |       <Route path="/shop-small" element= |       <Route path="/shop-small-old" element=
 * @mutate src/pages/info/holidays/HolidayHub.tsx |           <Link to="/shop-small" className="link-standard"> |           <Link to="/gift-guides" className="link-standard">
 * @mutate src/pages/info/giftGuides/SmallBizLocal.tsx | <h2 id="gift-sbs-local">{heading?.title ?? W.sectionTitle} | <h2 id="gift-sbs-local">{W.sectionTitle}
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
  PublicHeaderPage: ({ children, title }: { children: React.ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main>,
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

/** The retired guide pages: each slug gate in GiftGuides.tsx whose slug is not live, and the file of the component it renders. */
async function retiredPages(): Promise<{ slug: string; file: string }[]> {
  const pageFile = resolve(SRC, "pages/info/GiftGuides.tsx");
  const src = code(pageFile);
  const out: { slug: string; file: string }[] = [];
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\(?\s*slug\s*===\s*(\w+)\s*&&\s*isLiveGuide\(\s*\2\s*\)/g)) {
    const [, gateVar, constName] = m;
    // The slug constant's module and value.
    const imp = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].find((i) => i[1].split(",").map((s) => s.trim()).includes(constName));
    if (!imp) throw new Error(`GiftGuides.tsx: no import for ${constName}`);
    const mod = (await import(/* @vite-ignore */ resolveImport(pageFile, imp[2])!)) as Record<string, unknown>;
    const slug = String(mod[constName]);
    // Every component the gate renders: each `<gate> ? <Component` (the page body and, since 11-21, its tool row).
    const comps = [...src.matchAll(new RegExp(`\\b${gateVar}\\s*\\?\\s*<(\\w+)`, "g"))].map((c) => c[1]);
    if (comps.length === 0) throw new Error(`GiftGuides.tsx: gate ${gateVar} renders no component`);
    for (const comp of comps) {
      const compImp = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].find((i) => i[1].split(",").map((s) => s.trim()).includes(comp));
      if (!compImp) throw new Error(`GiftGuides.tsx: no import for ${comp}`);
      if (!isLiveGuide(slug)) out.push({ slug, file: resolveImport(pageFile, compImp[2])! });
    }
  }
  return out;
}

describe("a form never lives only on a retired gift guide page (class guard)", () => {
  it("every form a retired page reaches is also reachable from App.tsx without it", async () => {
    const retired = await retiredPages();
    // Inventory floor: the gates exist (Small Business Saturday and the deals page are retired today).
    expect(retired.length).toBeGreaterThan(0);
    const skip = new Set(retired.map((r) => r.file));
    const live = reachable([resolve(SRC, "App.tsx")], skip);
    expect(live.size).toBeGreaterThan(100);
    const formsBehindRetired = [...reachable(retired.map((r) => r.file), new Set())].filter(hasForm);
    // Inventory floor: the small business sign-up form is one of them.
    expect(formsBehindRetired.length).toBeGreaterThan(0);
    const stranded = formsBehindRetired.filter((f) => !live.has(f)).map((f) => f.slice(ROOT.length + 1));
    expect(stranded, "a form reachable only through a retired guide page: give it a live page").toEqual([]);
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
    expect(blankComments(read("src/App.tsx"))).toMatch(/<Route path="\/shop-small" element=\{[^\n]*<ShopSmall \/>/);
    expect(PUBLIC_PAGE_META["/shop-small"].canonical).toMatch(/\/shop-small$/);
    expect(infoPageBody("/shop-small")).toContain("Shop Small Louisiana");
    const rewrites = (JSON.parse(read("vercel.json")) as { rewrites: { source: string; destination: string }[] }).rewrites.filter((r) => r.source === "/shop-small");
    expect(rewrites.map((r) => r.destination)).toEqual(["/api/share?_og=page&_id=shop-small", "/index.html"]);
    expect(read("public/sitemap.xml")).toContain("<loc>https://www.louisianahelpr.com/shop-small</loc>");
    expect(blankComments(read("src/hooks/useAppShellViewport.ts")).match(/"\/shop-small"/g)?.length).toBe(2);
    expect(blankComments(read("src/pages/info/holidays/HolidayHub.tsx"))).toMatch(/<Link to="\/shop-small"/);
  });
});
