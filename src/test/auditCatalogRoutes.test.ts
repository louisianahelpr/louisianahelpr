import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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

function screensIn(listName: string): { name: string; url: string }[] {
  const block = new RegExp(
    `export const ${listName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`,
  ).exec(catalogSrc);
  if (!block) throw new Error(`${listName} not found in auditRoutes.ts`);
  return [...block[1].matchAll(/name:\s*"([^"]+)"[\s\S]*?url:\s*"([^"]+)"/g)].map(
    (m) => ({ name: m[1], url: m[2] }),
  );
}

/**
 * Rows that intentionally do NOT render their own route. Each needs a reason,
 * because "it's fine, it redirects" is exactly the assumption that let 13 dead
 * rows sit in the catalog.
 */
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
