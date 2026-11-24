import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import GiftGuides from "@/pages/info/GiftGuides";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { WISH_CORE } from "@/content/giftWishListCore";
import { setPrerenderPhone } from "./useIsMobileStub";

/**
 * GUIDE FIRST SCREENS IN THE RAW HTML (owner rule: pages under 2 s; guide prerender lane 2026-11-24). On Slow 4G + 4x
 * CPU the app's own boot ends at ~2.4 s, so a guide page could never draw its gifts before ~4.5 s however small its
 * chunk. The build renders each live guide page (and the deals days and the /gift-guides landing) with the page's
 * OWN component, GiftGuides, at both widths (useIsMobile is aliased to ./useIsMobileStub by the prerender's Vite
 * config); scripts/prerender-static-pages.mjs trims it to its first screen (src/lib/guideShell.mjs), adds the rules
 * that screen needs, and writes scripts/generated/guide-shells.js; api/share.ts draws it first inside #boot-loader, and
 * src/boot/guideShellHandoff.ts keeps it over the booting app until the page's own list is on screen.
 *
 * Same component and data as the page, so the first screen cannot drift from it. Guard: src/test/guideShells.test.ts.
 */

/** The pages that get a first screen: the landing, then every live guide (deals days and the sponsors page included). */
export const GUIDE_SHELL_PATHS: string[] = ["/gift-guides", ...LIVE_GUIDES_1121.map((s) => `/gift-guides/${s}`)];

// A static render reads each store's client snapshot (the picks are loaded before it), so a hook written without a
// server snapshot renders as it would once the store has settled. Patched on the server renderer's hook table
// (React 18 internals), because a page's own imports are bound before this module runs.
type Dispatcher = { useSyncExternalStore?: (s: unknown, g: unknown, gs?: unknown) => unknown; __lh?: boolean };
const internals = (React as unknown as Record<string, { ReactCurrentDispatcher: { current: Dispatcher | null } }>)
  .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
const holder = internals.ReactCurrentDispatcher;
if (!Object.getOwnPropertyDescriptor(holder, "current")?.get) {
  let current = holder.current;
  Object.defineProperty(holder, "current", {
    configurable: true,
    get: () => current,
    set: (d: Dispatcher | null) => {
      if (d && d.useSyncExternalStore && !d.__lh) {
        const orig = d.useSyncExternalStore;
        d.useSyncExternalStore = (s, g, gs) => orig(s, g, gs ?? g);
        d.__lh = true;
      }
      current = d;
    },
  });
}

function render(path: string, node: ReactNode): string {
  // No query runs during a static render.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The deals day's list is its own lazy chunk on the page ("Loading your list…" until it is in): drawn here in its place. */
const LOADING_LINE = `<p class="gg-soon" role="status">${WISH_CORE.loading}</p>`;

/** One page's markup as the app draws it once its data is in, at a phone's width or a desktop's. */
export async function renderGuidePage(path: string, phone: boolean): Promise<string> {
  await loadAllGuidePicks();
  setPrerenderPhone(phone);
  const page = render(
    path,
    <Routes>
      <Route path="/gift-guides" element={<GiftGuides />} />
      <Route path="/gift-guides/:slug" element={<GiftGuides />} />
    </Routes>,
  );
  const day = dealDay(path.replace(/^\/gift-guides\/?/, ""));
  if (!day) return page;
  if (!page.includes(LOADING_LINE)) throw new Error(`guide prerender: ${path} has no deals loading line to fill`);
  return page.replace(LOADING_LINE, () => render(path, <GiftGuideDeals day={day} />));
}

/** Every shell page at both widths: { path: { phone, desktop } }. */
export async function renderGuidePages(): Promise<Record<string, { phone: string; desktop: string }>> {
  const out: Record<string, { phone: string; desktop: string }> = {};
  for (const p of GUIDE_SHELL_PATHS) out[p] = { phone: await renderGuidePage(p, true), desktop: await renderGuidePage(p, false) };
  setPrerenderPhone(false);
  return out;
}
