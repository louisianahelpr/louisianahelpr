/**
 * Starts the page chunks of the routes routePreload.ts matches by PATTERN, not by exact path (PATH_PAGE_PATH): a
 * Declutter item page, Help center and a /hire/<service>/<town> page. It picks the page from the URL itself.
 *
 * One chunk for all three (Q2705, 11-06): each had its own boot chunk, and each loader plus its ENTRY_ROUTE_CHUNKS row
 * cost the ENTRY chunk bytes on every page; the info pages' row put the entry +69 B gz, over its band (lander l108).
 * Merged, the entry carries one loader and one pattern.
 *
 * - Declutter item (Q2708, 11-05): the guest/member gate (DeclutterGuestRoute) and the page (DeclutterItemPage) were
 *   asked for only once App.tsx had run and rendered the route. The item's two reads and first photo already start
 *   from the entry (declutterItemPrefetch.ts).
 * - Help center and the hire town pages (Q2705, 11-06): live (www, Slow 4G + 4x, 375, guest, 2 runs) /help drew its
 *   frame at ~3.1 s and its topic list (the LCP) at 4.9-5.0 s, when the HelpCenter chunk arrived. Lab (dummy-backend
 *   dists, guest, 375 Slow 4G + 4x, chromium, 3 runs, 0 outside requests): /help LCP 4572 -> 3748 ms,
 *   /hire/assembly/abbeville 4504 -> 3512 ms. The app's own frame (the header) draws later (/help 2.80 -> 3.55 s),
 *   since the page's bytes now share the link with the app's; the content is what moved up. The policy pages (Legal)
 *   are left out: they already drew with the app (2.84 s), and starting them here drew 3.73 s.
 *
 * Its own tiny chunk, like declutterRoute.ts: a preload list lives in the file that holds the import, so only a load
 * of one of these pages pays for it, and bootReach.mjs (which does not follow `import()`) reads no new first screen.
 * - The gift guides and the 25 Days page (speed 11-20): see their branch below.
 *
 * Rules: no static imports; the links it adds carry the mark index.html's boot watchdog skips; App.tsx's lazy imports
 * of the same modules own any failure.
 */
const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
if (path.startsWith("/declutter/item/")) {
  import("@/components/declutter/DeclutterGuestRoute").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
  import("@/pages/declutter/DeclutterItemPage").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (/^\/jobs\/[0-9a-f-]{36}$/i.test(path)) {
  // F288a (audit 11-10: job pages took 2.4-2.5 s to their largest paint on a phone). Measured 11-14 on a local build
  // against prod (390, 3x CPU, cold cache): JobDetail ran only after App.tsx, then asked for JobPage, and only then the
  // job's own read started (JobPage chunk at 2.67 s, read 2.74-2.96 s, LCP 3.02 s). Both chunks start here, beside the
  // app. JobPage is a member's page; a guest gets JobDetail's own guest page, so it is started only with a session.
  import("@/pages/jobs/JobDetail").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
  let member = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) member = true;
    }
  } catch {
    /* storage blocked: treat as signed out, as routePreload's hasToken does */
  }
  if (member) {
    import("@/pages/jobs/jobPage/JobPage").catch(() => {
      /* JobDetail's lazy import of the same module owns the failure */
    });
  }
} else if (path === "/help") {
  import("@/pages/info/HelpCenter").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (path.startsWith("/hire/")) {
  import("@/pages/info/HireTownPage").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (path === "/sponsor" || path === "/25days") {
  // Speed 11-20: on prod (www, Slow 4G + 4x, 375, guest, 2 runs) SponsorPage was asked for only once App.tsx had run,
  // so its sponsor_public_state read (the page waits on it: it says whether the giveaway is on) started at 6.9-7.0 s
  // and the first words drew at 8.3-8.6 s. The page, and with it the client its read needs, now start beside the app.
  import("@/pages/sponsor/SponsorPage").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (path.startsWith("/gift-guides") && !/^\/gift-guides\/(?:draw-names|swipe|planner)$/.test(path)) {
  // Speed 11-20: the gift guides page starts beside the app (the fun pages, draw-names, swipe and planner, are their
  // own chunks). On prod (same profile) the landing's covers drew at 7.3 s and a guide's list at 8.1 s. The page's own
  // module starts the guide's picks chunk as it runs (GiftGuides.tsx), before React renders it.
  import("@/pages/info/GiftGuides").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
  // Guide speed 1124 (speed-1122n S4/S5): a deals day page drew "Loading your list…", then "Loading deals…", then its
  // cards, because its chunk and its deals file each waited for the one before (GiftGuides -> GiftGuideDeals ->
  // giftGuideDeals.json). The deals file (a leaf: no imports) starts here, beside the page; GiftGuides.tsx starts
  // GiftGuideDeals as it runs. Starting GiftGuideDeals here too split the guides' shared chunk (+2 KB gz on every
  // guide's critical path, over its budget).
  if (/^\/gift-guides\/(?:black-friday|small-business-saturday|cyber-monday)$/.test(path)) {
    import("@/content/giftGuideDeals.json").catch(() => {
      /* GiftGuideDeals' import of the same module owns the failure */
    });
  }
  // speed-1122n S6: Small Business Saturday's businesses file (a leaf too) starts beside its page.
  if (path === "/gift-guides/small-business-saturday") {
    import("@/content/giftGuideSmallBiz.json").catch(() => {
      /* SmallBizGrid's import of the same module owns the failure */
    });
  }
} else if (path === "/holidays") {
  // Guide speed 1124 (speed-1122n S2): the Holiday Hub drew at 5.7 s; its page chunk waited for App.tsx.
  import("@/pages/info/holidays/HolidayHub").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
}
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
