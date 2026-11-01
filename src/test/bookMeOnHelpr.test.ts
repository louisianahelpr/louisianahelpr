/**
 * "Book me on Helpr" (owner-approved growth item, B59, 2026-10-29).
 *
 * Before: a Helpr had no link of their own to share. /user/:id is members-only and its card says
 * "Profiles on Helpr are visible to members", so a Helpr posting in a Facebook or Nextdoor group had
 * nothing a neighbor could book from. Now /book/<user id> is a public page (masked name, photo, counts,
 * the Helpr Guarantee) whose "Book <First>" opens Post a job with a direct offer set (?offerTo=),
 * through signup when needed; api/share.ts gives it a real card; and record_booking_source records
 * which Helpr brought a new poster (SQL behaviour: src/test/pglite/bookMeBookingSource.pglite.mjs).
 *
 * @mutate src/App.tsx |       <Route path="/book/:userId" element={<RouteErrorBoundary>{routeEl(<BookHelprPage />)}</RouteErrorBoundary>} /> |       <Route path="/book/:userId" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><BookHelprPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
 * @mutate src/lib/bookMe.ts |   return signedIn ? bookOfferPath(userId) : signupUrlFor(bookOfferPath(userId)); |   return signedIn ? bookOfferPath(userId) : "/signup";
 * @mutate src/lib/bookMe.ts |   if (remembered !== offerTo) return "none"; |   if (!remembered) return "none";
 * @mutate api/share.ts |   if (route.kind === "book") { |   if (false) {
 * @mutate vercel.json |       "destination": "/api/share?_og=book&_id=:userId" |       "destination": "/api/share?_og=user&_id=:userId"
 * @mutate src/pages/post-job/useJobFormEffects.ts |     void recordBookingSourceFor(offerTo); |
 * @mutate src/pages/post-job/CheckoutStepView.tsx |       <FirstPostGuarantee oneHelpr={!form.isGroupJob} firstPost={form.isFirstPost === true} /> |
 * @mutate src/components/guarantee/FirstPostGuarantee.tsx |   if (!oneHelpr \|\| !firstPost) return null; |   if (!oneHelpr) return null;
 * @mutate src/pages/user/BookMeShareButton.tsx |       {userId && <BookMeShareButton userId={userId} displayName={displayName} />} |
 * @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx |           ? [{ key: "book-me", |           ? [{ key: "referral",
 * @mutate src/lib/guarantee/promiseCopy.ts |   "If it still isn't right, Louisiana Helpr steps in."; |   "If it still isn't right, you get your money back.";
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const read = (p: string) => readFileSync(resolve(p), "utf8");
const HELPR = "3f2a1b0c-1111-4222-8333-444455556666";
const OTHER = "9a8b7c6d-1111-4222-8333-444455556666";

describe("the link and the way in", () => {
  it("the share link is the public /book page on the real origin", async () => {
    const { bookMeLink } = await import("@/lib/bookMe");
    expect(bookMeLink(HELPR)).toBe(`https://www.louisianahelpr.com/book/${HELPR}`);
  });

  it("Book <First> opens Post a job with the direct offer set; signed out goes through signup and back to the same offer", async () => {
    const { bookCtaHref, firstNameOf } = await import("@/lib/bookMe");
    expect(bookCtaHref(HELPR, true)).toBe(`/post-job?offerTo=${HELPR}`);
    expect(bookCtaHref(HELPR, false)).toBe(`/signup?redirect=${encodeURIComponent(`/post-job?offerTo=${HELPR}`)}`);
    expect(firstNameOf("Marie T.")).toBe("Marie");
    expect(firstNameOf("")).toBe("this Helpr");
  });

  it("/book/:userId is a public route (no sign-in wall)", () => {
    const app = blankComments(read("src/App.tsx"));
    expect(app).toContain('<Route path="/book/:userId" element={<RouteErrorBoundary>{routeEl(<BookHelprPage />)}</RouteErrorBoundary>} />');
  });

  it("Post a job records the source on landing with that Helpr's offer", () => {
    const effects = blankComments(read("src/pages/post-job/useJobFormEffects.ts"));
    const at = effects.indexOf("void recordBookingSourceFor(offerTo);");
    expect(at).toBeGreaterThan(effects.indexOf('const offerTo = searchParams.get("offerTo");'));
  });
});

describe("where the link and the guarantee show", () => {
  it("own profile has the share button and the profile menu has a Book me row to your /book page", () => {
    // B66: the pair lives in OwnProfileActions (BookMeShareButton.tsx) so UserProfile.tsx keeps its size baseline.
    const profile = blankComments(read("src/pages/user/UserProfile.tsx"));
    expect(profile).toContain("<OwnProfileActions userId={userId} displayName={displayName} />");
    const actions = blankComments(read("src/pages/user/BookMeShareButton.tsx"));
    expect(actions).toContain("{userId && <BookMeShareButton userId={userId} displayName={displayName} />}");
    const menu = blankComments(read("src/components/profile/profileLanding/useProfileLandingDerived.tsx"));
    expect(menu).toMatch(/key: "book-me", label: "Book me on Helpr"[^}]*href: `\/book\/\$\{profile\.user_id\}`/);
  });

  it("the guarantee shows at Review on a first one-Helpr post, on /book and on the landing's hire steps", () => {
    expect(blankComments(read("src/pages/post-job/CheckoutStepView.tsx"))).toContain("<FirstPostGuarantee oneHelpr={!form.isGroupJob} firstPost={form.isFirstPost === true} />");
    const first = blankComments(read("src/components/guarantee/FirstPostGuarantee.tsx"));
    expect(first).toContain("if (!oneHelpr || !firstPost) return null;");
    expect(blankComments(read("src/pages/book/BookHelprPage.tsx"))).toContain("<GuaranteePromise />");
    // Not on the home page's How a job works (owner, 2026-10-31): src/test/howAJobWorksFits.test.tsx.
  });
});

describe("which Helpr brought a new poster (client side)", () => {
  beforeEach(() => {
    rpc.mockReset();
    localStorage.clear();
  });

  it("records only when the remembered Helpr is the one being offered the job, once", async () => {
    const { rememberBookingSource, recordBookingSourceFor } = await import("@/lib/bookMe");
    rpc.mockResolvedValue({ data: "recorded", error: null });
    rememberBookingSource(HELPR);
    expect(await recordBookingSourceFor(OTHER)).toBe("none");
    expect(rpc).not.toHaveBeenCalled();
    expect(await recordBookingSourceFor(HELPR)).toBe("recorded");
    expect(rpc).toHaveBeenCalledWith("record_booking_source", { p_helpr_id: HELPR });
    expect(await recordBookingSourceFor(HELPR)).toBe("none");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("an offer that never came through a /book link records nothing", async () => {
    const { recordBookingSourceFor } = await import("@/lib/bookMe");
    expect(await recordBookingSourceFor(HELPR)).toBe("none");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the Helpr Guarantee promise matches the terms", () => {
  it("says redo first and then Helpr steps in, never a refund or money back", async () => {
    const { GUARANTEE_PROMISE_BODY } = await import("@/lib/guarantee/promiseCopy");
    const { GUARANTEE_RULES } = await import("@/lib/guarantee/rules");
    expect(GUARANTEE_PROMISE_BODY).toContain(`within ${GUARANTEE_RULES.claimWindowHours} hours`);
    expect(GUARANTEE_PROMISE_BODY).toContain("comes back to fix it");
    expect(GUARANTEE_PROMISE_BODY).toContain("one-Helpr job");
    expect(GUARANTEE_PROMISE_BODY).not.toMatch(/money back|refund|fee/i);
    const terms = read("src/pages/info/legal/TermsSection.tsx");
    expect(terms).toContain("If a one-Helpr job wasn&apos;t done right");
    expect(terms).toContain("it becomes a dispute that Helpr decides");
  });
});

describe("the link preview (api/share.ts + vercel.json)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let profiles: unknown = [];
  let stats: unknown = [];
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const body = u.endsWith("/rpc/get_safe_profiles") ? profiles : u.endsWith("/rpc/get_public_profile_stats") ? stats : undefined;
      if (body === undefined) throw new Error(`unexpected fetch ${u}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const page = async (id: string) => handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=book&_id=${id}`));

  it("a Helpr's link previews with their masked name, town and counts, noindex, linking back to /book", async () => {
    profiles = [{ full_name: "Marie T.", location: "Lafayette" }];
    stats = [{ review_count: 12, avg_rating: 4.92, completed_jobs_as_helper: 8 }];
    const html = await (await page(HELPR)).text();
    expect(html).toContain('<meta property="og:title" content="Book Marie T. on Louisiana Helpr"');
    expect(html).toContain('<meta property="og:description" content="Marie is a Helpr in Lafayette on Louisiana Helpr. 4.9 stars (12 reviews) · 8 jobs done. Covered by the Helpr Guarantee.');
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html).toContain(`<meta property="og:url" content="https://www.louisianahelpr.com/book/${HELPR}"`);
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
    expect(html.match(/<meta property="og:description" content="([^"]*)"/)?.[1]).not.toMatch(/fee/i);
  });

  it("a Helpr the public gate does not show, or a non-id path, is a noindex 'isn't available' card", async () => {
    profiles = [];
    let html = await (await page(HELPR)).text();
    expect(html).toContain("This Helpr isn&#39;t available");
    html = await (await page("not-an-id")).text();
    expect(html).toContain("This Helpr isn&#39;t available");
  });

  it("vercel.json rewrites /book/<id> to the card before the SPA catch-all and sends noindex", () => {
    const v = JSON.parse(read("vercel.json")) as {
      rewrites: { source: string; destination: string }[];
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const rw = v.rewrites.find((r) => r.destination === "/api/share?_og=book&_id=:userId");
    expect(rw?.source.startsWith("/book/:userId(")).toBe(true);
    expect(v.rewrites.indexOf(rw!)).toBeLessThan(v.rewrites.findIndex((r) => r.destination === "/index.html"));
    expect(v.headers.find((x) => x.source === "/book/(.*)")?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
    expect(v.rewrites.length).toBeGreaterThan(10);
  });
});
