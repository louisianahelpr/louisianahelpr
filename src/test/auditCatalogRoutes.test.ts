import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * The audit catalog must describe the app that exists.
 *
 * Both sweeps (visual-audit, empty-state, error-state) walk the screen lists in
 * e2e/happy-path/auditRoutes.ts and report "N screens, clean". That number is
 * only meaningful if each row actually renders the screen it is named after,
 * and the catalog has drifted in BOTH directions without anything noticing:
 *
 *   - Under-counting: ADMIN_SCREENS held one row, `/admin`, while /admin is a
 *     ?view= shell over 27 views. 26 admin screens — payouts, disputes, fraud,
 *     IDV — were never rendered by any sweep, which is why every admin defect
 *     to date was found by hand.
 *   - Over-counting: 13 ANON rows pointed at routes whose redirect stubs had
 *     been deleted (2352466e). Each one rendered the NotFound page, passed, and
 *     counted as a distinct audited screen. Two more pointed at ProtectedRoute
 *     pages and audited the login screen under the wrong name.
 *
 * Both failures are silent: the sweep stays green either way, because a 404
 * page and a login page are both perfectly accessible pages. This test is the
 * thing that isn't silent. It is deliberately STATIC — parsing the route table
 * rather than driving a browser — so it costs milliseconds and fails in vitest
 * long before a 40-minute sweep would have quietly passed.
 */

const repoRoot = resolve(__dirname, "../..");
const appSrc = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");
const catalogSrc = readFileSync(
  resolve(repoRoot, "e2e/happy-path/auditRoutes.ts"),
  "utf8",
);

/**
 * Resolve a build-time feature flag (`export const X = true|false`) out of
 * src/config. Routes written as `{FLAG && <Route …>}` are NOT registered when
 * the flag is false, and a text-only scan of App.tsx cannot tell the
 * difference.
 */
function flagValue(name: string): boolean | null {
  for (const file of readdirSync(resolve(repoRoot, "src/config"))) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(resolve(repoRoot, "src/config", file), "utf8");
    const m = new RegExp(`export const ${name}\\s*=\\s*(true|false)`).exec(src);
    if (m) return m[1] === "true";
  }
  return null;
}

/**
 * Every `path=` actually registered in the router, redirects included, with
 * flag-gated routes dropped when their flag is off.
 */
const registered = [...appSrc.matchAll(/(\{\s*(\w+)\s*&&\s*)?<Route\s+path="([^"]+)"/g)]
  .filter((m) => {
    const guard = m[2];
    if (!guard) return true;
    const value = flagValue(guard);
    // An unknown guard is treated as ON: better to let a row through than to
    // silently drop coverage because a flag moved out of src/config.
    return value !== false;
  })
  .map((m) => m[3]);

/** Paths whose element tree includes ProtectedRoute. */
const protectedPaths = new Set(
  [...appSrc.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)]
    .filter((m) => m[2].includes("ProtectedRoute"))
    .map((m) => m[1]),
);

function resolveRoute(url: string): string | null {
  const path = url.split("?")[0];
  if (registered.includes(path)) return path;
  for (const r of registered) {
    if (!r.includes(":")) continue;
    const rx = new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`);
    if (rx.test(path)) return r;
  }
  return null;
}

function screensIn(listName: string): { name: string; url: string; redirectsTo?: string }[] {
  const block = new RegExp(
    `export const ${listName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`,
  ).exec(catalogSrc);
  if (!block) throw new Error(`${listName} not found in auditRoutes.ts`);
  return [
    ...block[1].matchAll(
      /name:\s*"([^"]+)"[\s\S]*?url:\s*"([^"]+)"(?:\s*,\s*redirectsTo:\s*"([^"]+)")?/g,
    ),
  ].map((m) => ({ name: m[1], url: m[2], redirectsTo: m[3] }));
}

/**
 * Rows that intentionally do NOT render their own route. Each needs a reason,
 * because "it's fine, it redirects" is exactly the assumption that let 13 dead
 * rows sit in the catalog.
 */
// @two-way src/test/auditCatalogRoutes.test.ts:const staleUnresolved =
const ALLOWED_UNRESOLVED: Record<string, string> = {
  "not-found": "The row's entire purpose is to render the 404 screen.",
};

/**
 * Route patterns no catalog row covers, and why that is correct.
 *
 * This list is checked BOTH ways. A pattern here must be absent from the
 * catalog (or it is stale), and — the part that matters — its route element
 * must actually be a redirect, asserted against App.tsx below. A route that
 * paints pixels cannot be excused by writing a sentence about it here.
 *
 * `*` is the NotFound catch-all, which the `not-found` catalog row renders;
 * it is listed because resolveRoute() deliberately returns null for a URL that
 * matches nothing else, so the row can never "resolve" to it.
 */
const UNSWEPT_ROUTES: Record<string, string> = {
  "*": "The NotFound catch-all; the `not-found` catalog row is what renders it.",
  "/warnings": "Navigate to /profile?tab=warnings — the catalog sweeps the profile tab.",
  "/help-center": "Navigate to /help — an alias for the URL people type; the catalog sweeps /help.",
  "/j/:id": "ShortLinkRedirect — resolves an id and navigates; paints nothing.",
  "/u/:id": "ShortLinkRedirect — resolves an id and navigates; paints nothing.",
  "/m/:id": "ShortLinkRedirect — resolves an id and navigates; paints nothing.",
  "/messages/:id": "ShortLinkRedirect onto the real /messages thread, which the catalog sweeps.",
  "/post-job/*": "ShortLinkRedirect for legacy /post-job/* deep links onto /post-job.",
  "/legal/:tab": "ShortLinkRedirect onto /legal?tab=…, which the catalog sweeps.",
};

/** The element source for a given `path=`, so an excuse can be verified. */
function elementFor(path: string): string | null {
  for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    if (m[1] === path) return m[2];
  }
  return null;
}

/**
 * Is this route element an UNCONDITIONAL forward?
 *
 * Two shapes count: a literal `<Navigate …>` at the route, and a wrapper
 * component whose whole body is one (ActivityLegacyRedirect, DataRightsRedirect,
 * ShortLinkRedirect).
 *
 * `<MarketingRedirect>` is the shape that must NOT count, and the reason the
 * test below is derived rather than name-matched: it takes `children` and
 * renders them for a guest, so `/` and `/browse` genuinely paint the screens
 * their catalog rows name. The discriminator is exactly that — a wrapper that
 * can render children is a conditional gate; one that cannot is a redirect.
 */
function isUnconditionalRedirect(element: string): boolean {
  if (/<Navigate\b/.test(element)) return true;
  for (const m of element.matchAll(/<(\w*Redirect)\b/g)) {
    const name = m[1];
    const importLine = new RegExp(
      `(?:import\\s+${name}\\s+from|const ${name} = lazy\\(\\(\\) => import\\()\\s*"([^"]+)"`,
    ).exec(appSrc);
    if (!importLine) continue;
    const rel = importLine[1].replace(/^@\//, "src/").replace(/^\.\//, "src/");
    let src: string;
    try {
      src = readFileSync(resolve(repoRoot, `${rel}.tsx`), "utf8");
    } catch {
      try {
        src = readFileSync(resolve(repoRoot, `${rel}.ts`), "utf8");
      } catch {
        continue;
      }
    }
    // Renders whatever it was given → it is a gate around a real screen.
    if (/\bchildren\b/.test(src)) continue;
    if (/<Navigate\b|\bnavigate\(/.test(src)) return true;
  }
  return false;
}

// @mutate src/App.tsx | <Route path="/help" | <Route path="/helpdesk"
// Proves the alias classification is load-bearing: drop the declaration off a
// row whose route is a <Navigate> and it goes back to being counted as an
// independently audited screen.
// @mutate e2e/happy-path/auditRoutes.ts | { name: "settings", url: "/settings", redirectsTo: "/profile" }, | { name: "settings", url: "/settings" },
// Proves reclassification cannot open a hole: remove the row that actually
// audits the gift_card tab and /gift-card's alias target is orphaned.
// @mutate e2e/happy-path/auditRoutes.ts | { name: "profile-gift-card", url: "/profile?tab=gift_card" }, | 
// Proves the second catalog is covered too: a dead route put back into
// overlay-sweep's own ROUTES list must fail here, not be probed silently.
// @mutate e2e/happy-path/overlay-sweep.spec.ts |   "/profile?tab=pets", |   "/profile?tab=pets",\n  "/job-history",
// Third catalog, same proof: a dead route back in desktop-fill's list must fail.
// @mutate e2e/visual-audit/desktop-fill.spec.ts |   { path: "/help", auth: "anon" }, |   { path: "/help", auth: "anon" },\n  { path: "/subscription", auth: "anon" },
describe("audit catalog matches the real route table", () => {
  it("every ANON screen resolves to a registered, publicly reachable route", () => {
    const broken = screensIn("ANON_SCREENS")
      .filter((s) => !ALLOWED_UNRESOLVED[s.name])
      .map((s) => {
        const r = resolveRoute(s.url);
        if (r === null) return `${s.name} (${s.url}) → no route: renders NotFound`;
        if (protectedPaths.has(r))
          return `${s.name} (${s.url}) → ProtectedRoute: renders the login screen, not this page`;
        return null;
      })
      .filter(Boolean);

    expect(broken, `ANON_SCREENS rows that do not render what they claim:\n  - ${broken.join("\n  - ")}`).toEqual([]);

    // TWO-WAY: an ALLOWED_UNRESOLVED name that is no longer an ANON row, or
    // whose row now resolves to a public route, is excusing nothing.
    const anon = new Map(screensIn("ANON_SCREENS").map((s) => [s.name, s.url]));
    const staleUnresolved = Object.keys(ALLOWED_UNRESOLVED).filter((name) => {
      const url = anon.get(name);
      if (url === undefined) return true;
      const r = resolveRoute(url);
      return r !== null && !protectedPaths.has(r);
    });
    expect(staleUnresolved.map((n) => `stale baseline entry ${n} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("every AUTHED and ADMIN screen resolves to a registered route", () => {
    const broken = [...screensIn("AUTHED_SCREENS"), ...screensIn("ADMIN_SCREENS")]
      .filter((s) => resolveRoute(s.url) === null)
      .map((s) => `${s.name} (${s.url}) → no route: renders NotFound`);

    expect(broken, `Catalog rows with no matching route:\n  - ${broken.join("\n  - ")}`).toEqual([]);
  });

  /**
   * The direction the catalog was never checked in.
   *
   * The two tests above ask "does every catalog row render a real route?" —
   * they catch a row pointing at a route that no longer exists. They cannot
   * catch the opposite and more expensive failure: a route that exists and
   * that no row points at. Such a route is swept by nothing, forever, and
   * every sweep still reports "N screens, clean" — the number is simply
   * measured over a smaller app than the one that shipped.
   *
   * Measured when this test was written: 46 registered patterns, 71 catalog
   * rows, and 8 patterns no row reached. All eight turned out to be redirects,
   * so the honest fix was to name them rather than to sweep them — but nothing
   * had established that, and the next route added will not be a redirect.
   *
   * This is the same shape as the registries-checked-against-themselves trap:
   * derive the set from the world (App.tsx), then diff it against the list.
   */
  it("every registered route is swept by a catalog row, or excused with a verified reason", () => {
    const rows = [
      ...screensIn("ANON_SCREENS"),
      ...screensIn("AUTHED_SCREENS"),
      ...screensIn("ADMIN_SCREENS"),
    ];
    const covered = new Set(rows.map((s) => resolveRoute(s.url)).filter(Boolean));

    const unswept = [...new Set(registered)]
      .filter((r) => !covered.has(r) && !UNSWEPT_ROUTES[r])
      .map((r) => `${r} → no catalog row renders it, and it is not in UNSWEPT_ROUTES`);

    expect(
      unswept,
      "Routes no sweep will ever visit. Add a row to the right list in " +
        "e2e/happy-path/auditRoutes.ts, or — only if the route paints nothing — " +
        `add it to UNSWEPT_ROUTES with the reason:\n  - ${unswept.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("every UNSWEPT_ROUTES excuse is still true", () => {
    const wrong = Object.keys(UNSWEPT_ROUTES)
      .filter((p) => p !== "*")
      .map((p) => {
        if (!registered.includes(p)) return `${p} → no longer a route; drop it from UNSWEPT_ROUTES`;
        const el = elementFor(p);
        if (el === null) return `${p} → could not read its element from App.tsx`;
        // The whole excuse is "it paints nothing". Anything that is not a
        // redirect renders a screen, and a screen has to be swept.
        if (!/Navigate|ShortLinkRedirect/.test(el))
          return `${p} → excused as a redirect but its element is ${el.trim().slice(0, 60)}…; it renders a screen, so it needs a catalog row`;
        return null;
      })
      .filter(Boolean);

    expect(
      wrong,
      `UNSWEPT_ROUTES entries that no longer describe the app:\n  - ${wrong.join("\n  - ")}`,
    ).toEqual([]);
  });

  /**
   * ALIASES MUST BE DECLARED AS ALIASES.
   *
   * A catalog row whose route is a `<Navigate>` does not render a screen of its
   * own — it renders somebody else's. Until 2026-09-21 nothing said so, and the
   * sweeps counted each one as an independently audited screen: measured over 92
   * screens, 15 landed somewhere other than the route requested and six of those
   * were a second name for a screen the catalog already had a row for. Every
   * sweep report therefore overstated its own coverage, in the one direction a
   * green run cannot reveal.
   *
   * This is derived from App.tsx, not from the catalog, so it is not a list
   * checked against itself: if a route BECOMES a redirect, the row that points
   * at it starts failing until somebody classifies it.
   */
  it("every catalog row pointing at a router redirect declares redirectsTo", () => {
    const rows = [
      ...screensIn("ANON_SCREENS"),
      ...screensIn("AUTHED_SCREENS"),
      ...screensIn("ADMIN_SCREENS"),
    ];
    const undeclared = rows
      .map((s) => {
        const r = resolveRoute(s.url);
        if (!r) return null;
        const el = elementFor(r);
        if (!el || !isUnconditionalRedirect(el)) return null;
        if (s.redirectsTo) return null;
        return `${s.name} (${s.url}) → its route element is a redirect (${el.trim().slice(0, 50)}…) but the row claims to audit a screen of its own`;
      })
      .filter(Boolean);

    expect(
      undeclared,
      "Catalog rows that silently audit a DIFFERENT screen than they name. Add " +
        "`redirectsTo: \"<destination>\"` to each so it stops being counted as " +
        `coverage of its own route:\n  - ${undeclared.join("\n  - ")}`,
    ).toEqual([]);
  });

  /**
   * The failure mode reclassification itself creates. `/gift-card` was the ONLY
   * row rendering the Profile gift_card tab; marking it an alias without adding
   * `profile-gift-card` would have turned an overstated count into a real hole,
   * silently. So every alias target must have a row of its own, and that row
   * must not itself be an alias.
   */
  it("every redirectsTo target is audited by a real (non-alias) row", () => {
    const rows = [
      ...screensIn("ANON_SCREENS"),
      ...screensIn("AUTHED_SCREENS"),
      ...screensIn("ADMIN_SCREENS"),
    ];
    const real = new Set(rows.filter((s) => !s.redirectsTo).map((s) => s.url));
    const orphaned = rows
      .filter((s) => s.redirectsTo && !real.has(s.redirectsTo))
      .map(
        (s) =>
          `${s.name} forwards to ${s.redirectsTo}, and no non-alias catalog row audits that URL — the destination screen is now swept by nothing`,
      );

    expect(
      orphaned,
      `Alias destinations with no row of their own:\n  - ${orphaned.join("\n  - ")}`,
    ).toEqual([]);
  });

  /**
   * overlay-sweep.spec.ts keeps its OWN route list — a second catalog, with
   * none of the checks above pointed at it. Measured 2026-09-21: three of its
   * 66 entries (`/family`, `/subscription`, `/job-history`) were not registered
   * routes at all. Each rendered the NotFound page, found no overlays on it,
   * and was counted as another route probed — the exact over-count this file
   * was written to stop, in the one catalog it was not looking at.
   */
  /**
   * ONE MORE COPY. e2e/visual-audit/desktop-fill.spec.ts keeps a THIRD route
   * list, and it had rotted the same way: `/subscription` and `/family` are not
   * registered routes, so both measured the NotFound screen — whose centred
   * card fills 25% of a 1440px viewport — and failed the desktop-fill standard
   * on the 404 page's behalf. Nobody saw it because no workflow runs that spec.
   */
  it("every route desktop-fill measures is a registered route", () => {
    const src = blankComments(
      readFileSync(resolve(repoRoot, "e2e/visual-audit/desktop-fill.spec.ts"), "utf8"),
    );
    const block = /const ROUTES: Route\[\] = \[([\s\S]*?)\n\];/.exec(src);
    expect(block, "ROUTES not found in desktop-fill.spec.ts").toBeTruthy();
    const routes = [...block![1].matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10);

    const dead = routes
      .filter((r) => resolveRoute(r) === null)
      .map((r) => `${r} → no route: this measures the NotFound page and grades it as that route`);

    expect(
      dead,
      `desktop-fill ROUTES entries that render nothing:\n  - ${dead.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("every route overlay-sweep probes is a registered route", () => {
    // blankComments, not a regex chain: the removal note inside ROUTES names
    // the three dead paths IN QUOTES, and a comment-blind scan read them back
    // out as live entries. (Caught by this test failing on its own comment the
    // first time it ran — which is precisely what
    // src/test/guardsDoNotDeleteSource.test.ts exists to prevent.) It blanks
    // rather than deletes, so every offset still lines up.
    const sweepSrc = blankComments(
      readFileSync(resolve(repoRoot, "e2e/happy-path/overlay-sweep.spec.ts"), "utf8"),
    );
    const block = /const ROUTES = \[([\s\S]*?)\n\];/.exec(sweepSrc);
    expect(block, "ROUTES not found in overlay-sweep.spec.ts").toBeTruthy();
    // String literals only — the ADMIN_VIEWS spread is template literals and is
    // already covered by the admin test below.
    const routes = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10);

    const dead = routes
      .filter((r) => resolveRoute(r) === null)
      .map((r) => `${r} → no route: the sweep probes the NotFound page and counts it as a route audited`);

    expect(
      dead,
      `overlay-sweep ROUTES entries that render nothing:\n  - ${dead.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("ADMIN_SCREENS covers every view in the Admin page's View union", () => {
    const adminSrc = readFileSync(
      resolve(repoRoot, "src/pages/Admin.tsx"),
      "utf8",
    );
    const union = /type View =\s*([^;]+);/.exec(adminSrc);
    expect(union, "View union not found in Admin.tsx").toBeTruthy();
    const views = [...union![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(views.length).toBeGreaterThan(1);

    // ADMIN_SCREENS is generated by spreading ADMIN_VIEWS, so its rows are
    // template literals rather than the `url: "..."` string literals screensIn
    // matches. Read the source list directly — which is the point of it being
    // exported and shared with overlay-sweep.
    const list = /export const ADMIN_VIEWS = \[([\s\S]*?)\] as const;/.exec(
      catalogSrc,
    );
    expect(list, "ADMIN_VIEWS not found in auditRoutes.ts").toBeTruthy();
    const covered = new Set([
      "home",
      ...[...list![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    ]);
    const missing = views.filter((v) => !covered.has(v));

    expect(missing, `Admin views absent from ADMIN_SCREENS (they would never be rendered by any sweep):\n  - ${missing.join("\n  - ")}`).toEqual([]);
  });
});
