/**
 * ROUTE SKELETONS ARE THE PAGE'S SHAPE (Q201, owner 2026-09-23: "most of the
 * skeletons are not even the page shape").
 *
 * For every route App.tsx gives a named skeleton (routeSkeletonRoutes: the
 * skeletonOnDemand fallbacks, read from source), and every URL the route
 * inventory derives for it (all of Profile's tabs included), the page's own
 * lazy chunk is HELD at the wire, the skeleton frame is measured, the chunk is
 * released and the loaded page measured: the title and the first block must
 * sit within TOL_PX on top/left (block width too). The rule for "title" and
 * "first block" is scripts/audit/skeleton-shape.mjs FRAME_BOXES; its pure
 * halves are unit-tested in src/test/routeSkeletonShape.test.ts.
 *
 * Its own file, not a third test in page-settle.spec.ts: page-settle runs in
 * prod-audit leg 4, whose 28-minute suite step ran 28 min on run 38689259675;
 * leg 3 (34 of 42 min on the same run) has the room.
 *
 * Read-only on prod: every non-GET to Supabase is refused by writeFirewall
 * (read RPCs pass) and logged; nothing is clicked.
 *
 * KNOWN_SHAPES is the exact set still off when this landed, keyed by WHICH box
 * is off (the px move with prod data and are in each entry's comment). Exact
 * and two-way: a new mismatch fails, and so does a KNOWN entry that now
 * matches. SKELETON_SHOTS=<dir> saves both frames of every URL; a mismatch
 * attaches them to the report either way.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "../prodTest";
import { newUserContext, sessionFor, writeFirewall, POSTER_ID, HELPER_ID } from "./harness";
// @ts-expect-error -- plain Node ESM with no .d.mts (same as page-settle.spec.ts)
import { deriveRouteSet } from "../../scripts/audit/press-every-control.mjs";
import { PLACEHOLDER_SEL } from "../../scripts/audit/measure-loading-states.mjs";
import { TOL_PX, measureSkeletonShape, routeSkeletonRoutes } from "../../scripts/audit/skeleton-shape.mjs";
import { stripComments } from "../../scripts/perf/bootReach.mjs";

interface RouteRow { url: string; personas: string[]; redirect: boolean }

// @two-way e2e/prod-audit/skeleton-shape.spec.ts:KNOWN_SHAPES entries that now match: delete them
const KNOWN_SHAPES: Record<string, string> = {};

for (const width of [375, 1440] as const) {
  test(`route skeletons are the page's shape at ${width}px (title + first block within ${TOL_PX}px, page chunk held)`, async ({ browser, request }) => {
    test.setTimeout(15 * 60_000);
    const inv = routeSkeletonRoutes(stripComments(readFileSync("src/App.tsx", "utf8")));
    // Floor: /login, /home, /profile, /jobs, /posts, /browse when this landed.
    expect(inv.length, "routes with a named skeleton in App.tsx").toBeGreaterThan(4);
    const urls = (deriveRouteSet({ seedJobId: "test", helperId: HELPER_ID, customerId: POSTER_ID, adminViews: [] }) as RouteRow[])
      .filter((r) => !r.redirect)
      .map((r) => ({ ...r, route: inv.find((i) => new URL(r.url, "http://x").pathname === i.path) }))
      .filter((r) => r.route);
    // Every skeleton route is reached, and Profile's tabs with it.
    expect(new Set(urls.map((u) => u.route!.path)).size, "every skeleton route has a URL").toBe(inv.length);
    expect(urls.length).toBeGreaterThan(20);

    const session = await sessionFor(request, "poster");
    const breaches: Record<string, string> = {};
    const refused: string[][] = [];
    const shotsDir = process.env.SKELETON_SHOTS;
    for (const r of urls) {
      const signedIn = r.personas.includes("customer") && r.personas.includes("helper");
      const ctx = await newUserContext(browser, signedIn ? session : null, { desktop: width === 1440 });
      refused.push(await writeFirewall(ctx));
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
      const m = await measureSkeletonShape(ctx, page, new URL(r.url, test.info().project.use.baseURL).toString(), r.route!.chunk, PLACEHOLDER_SEL, { shots: true });
      await ctx.close();
      expect(m.error, `${r.url}: ${m.error}`).toBeUndefined();
      // 0 would mean the "skeleton frame" was the page itself: never a pass.
      expect(m.held, `${r.url}: the ${r.route!.chunk} chunk was held`).toBeGreaterThan(0);
      const slug = `${width}-${r.url.replace(/[^a-z0-9]+/gi, "_")}`;
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        if (m.skelPng) writeFileSync(`${shotsDir}/${slug}-skel.png`, m.skelPng);
        if (m.loadedPng) writeFileSync(`${shotsDir}/${slug}-loaded.png`, m.loadedPng);
      }
      if (m.diff?.length) {
        breaches[`${width} ${r.url}`] = m.diff.map((d) => d.replace(/ -?\d+->-?\d+$/, "")).join("; ");
        console.log(`[skeleton-shape] ${width} ${r.url}: ${m.diff.join("; ")} skel=${JSON.stringify({ title: m.skel?.title, block: m.skel?.block })} loaded=${JSON.stringify({ title: m.loaded?.title, block: m.loaded?.block })}`);
        if (m.skelPng) await test.info().attach(`${slug}-skeleton.png`, { body: m.skelPng, contentType: "image/png" });
        if (m.loadedPng) await test.info().attach(`${slug}-loaded.png`, { body: m.loadedPng, contentType: "image/png" });
      }
    }
    const blocked = refused.flat();
    if (blocked.length) console.log(`[skeleton-shape] firewall refused ${blocked.length}: ${JSON.stringify([...new Set(blocked.map((b) => b.split(" ").slice(0, 2).join(" ")))])}`);
    const known = Object.fromEntries(Object.entries(KNOWN_SHAPES).filter(([k]) => k.startsWith(`${width} `)));
    const added = Object.keys(breaches).filter((k) => known[k] !== breaches[k]);
    const cleared = Object.keys(known).filter((k) => !(k in breaches));
    expect(added.map((k) => `${k}: ${breaches[k]}`), "skeletons that are not their page's shape (or changed from KNOWN_SHAPES)").toEqual([]);
    expect(cleared, "KNOWN_SHAPES entries that now match: delete them").toEqual([]);
  });
}
