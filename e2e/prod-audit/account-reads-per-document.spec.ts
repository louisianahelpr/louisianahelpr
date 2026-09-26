/**
 * Q330 — account-level reads, counted INSIDE ONE DOCUMENT.
 *
 * Q104's meter counted, per journeys leg: user_blocks 59, profiles select=*
 * 49, user_roles 49, profiles terms_version_accepted 49, /auth/v1/user up to
 * 212 per press shard. A journeys leg does many full page loads, and every
 * load starts a fresh query cache, so those totals cannot say whether the APP
 * repeats a read or the HARNESS reloads (Q329's avatar counts turned out to be
 * the second). This spec separates the two: one sign-in, one document, then
 * client-side navigation across the signed-in screens (pushState + popstate,
 * the router's own path), counting each account-level read per screen.
 *
 * Read-only against prod: navigation only, the shared poster account.
 */
import { test, expect, type Page, type Request } from "../prodTest";
import { newUserContext, sessionFor } from "./harness";

const CLASSES: Record<string, (r: Request) => boolean> = {
  "user_blocks": (r) => /\/rest\/v1\/user_blocks\b/.test(r.url()),
  "profiles select=*": (r) => /\/rest\/v1\/profiles\?/.test(r.url()) && /[?&]select=\*(&|$)/.test(r.url()),
  "user_roles": (r) => /\/rest\/v1\/user_roles\b/.test(r.url()),
  "profiles terms_version_accepted": (r) => /\/rest\/v1\/profiles\?/.test(r.url()) && /select=terms_version_accepted/.test(r.url()),
  "/auth/v1/user": (r) => r.method() === "GET" && /\/auth\/v1\/user(\?|$)/.test(r.url()),
};

/** Signed-in screens, visited in one document; some twice (a return visit). */
const SCREENS = ["/browse", "/messages", "/activity", "/profile", "/posts", "/home", "/messages", "/profile"];
const DWELL_MS = 4_000;

/**
 * Per document, over the whole walk (a cold boot + SCREENS.length screens).
 * EXACT, two-way: set from the measured run below; a fix that lowers a count
 * lowers its number here in the same commit, and a count under it fails too.
 */
// Calibrated from prod-audit run 36212848613 (2026-09-26): boot /home read
// everything once (user_blocks twice), the first /messages re-read
// user_blocks, and the second /messages (past useCurrentUser's 30 s
// staleTime) re-read profile + roles. user_blocks: 3 → 2 once the feed and the
// nav badge shared one read (Q330, run 36213595709: boot 2 → 1).
export const PER_DOCUMENT: Record<string, number | null> = {
  "user_blocks": 2, // 3 before the shared read (run 36212848613), 2 after (run 36213595709)
  "profiles select=*": 2,
  "user_roles": 2,
  "profiles terms_version_accepted": 1,
  "/auth/v1/user": 1,
};

async function clientNav(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("account-level reads per document across 8 signed-in screens (Q330)", async ({ browser, request }) => {
  test.setTimeout(5 * 60_000);
  const poster = await sessionFor(request, "poster");
  const ctx = await newUserContext(browser, poster);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 375, height: 812 });

  const counts: Record<string, number> = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
  let screen = "boot /home";
  const perScreen: Record<string, Record<string, number>> = {};
  page.on("request", (r) => {
    for (const [k, match] of Object.entries(CLASSES)) {
      if (match(r)) {
        counts[k]++;
        (perScreen[screen] ??= {})[k] = ((perScreen[screen] ?? {})[k] ?? 0) + 1;
      }
    }
  });

  await page.goto("/home");
  await page.waitForTimeout(DWELL_MS + 2_000);
  for (const [i, s] of SCREENS.entries()) {
    screen = `${i + 1} ${s}`;
    await clientNav(page, s);
    await page.waitForTimeout(DWELL_MS);
  }
  const docs = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await ctx.close();

  const table = Object.entries(perScreen).map(([s, c]) => `${s}: ${JSON.stringify(c)}`).join("\n");
  test.info().annotations.push({ type: "measure", description: `per document: ${JSON.stringify(counts)}\n${table}` });
  console.log(`[account-reads] per document: ${JSON.stringify(counts)}\n${table}`);

  expect(docs, "the walk reloaded the document; it must stay client-side").toBe(1);
  // Something was measured at all: the boot reads the profile.
  expect(counts["profiles select=*"] + counts["/auth/v1/user"], "no account reads seen: the classifier is broken").toBeGreaterThan(0);
  for (const [k, budget] of Object.entries(PER_DOCUMENT)) {
    if (budget === null) continue; // not calibrated yet: the run above prints the number to write
    expect(counts[k], `${k}: ${counts[k]} per document (budget ${budget}, exact)`).toBe(budget);
  }
});
