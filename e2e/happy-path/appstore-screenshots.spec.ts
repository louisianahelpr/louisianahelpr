import { test, expect, FAKE_HELPER, installSupabaseMocks, mockRpc, mockTable, seedAuthedSession, type FakeUser, type MockRule } from "./fixtures";
import { DATE, SEED_JOBS } from "./seedData";

// App Store product-page screenshots, generated from the real app (1.0.4 refresh, owner 11-02: "refresh the App
// Store pictures"). OPT-IN, never part of CI: it makes marketing images and asserts only that each one shows the
// app working (populated, no error, no login form).
//
//   RUN_APPSTORE_SHOTS=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path appstore-screenshots
//
// It drives the ACTUAL signed-in app with every Supabase call answered by the happy-path mocks (fixtures.ts), so
// the sample content below is all there is: no real member, listing or message is ever read, and no request
// reaches the live backend. The "nothing reaches the backend" half is not assumed, it is checked on every shot
// (see `assertNothingReachedTheNetwork`) and by the write probe at the bottom.
//
// App Review rejected v1.0 under 2.3.3 for iPad shots that "only display a login screen", so every shot below waits
// for content that proves the screen is populated.
//
// SIZES ARE EXACT. deliver picks the App Store device slot from the pixel size, and these are CSS size x
// deviceScaleFactor, never upscaled:
//   iPhone 6.9"  440 x 956  @3 = 1320 x 2868  (deliver's APP_IPHONE_67 slot, which App Store Connect shows as 6.9")
//   iPad 13"    1024 x 1366 @2 = 2048 x 2732  (APP_IPAD_PRO_3GEN_129)
// iPhone 6.7" (430 x 932 @3 = 1290 x 2796) is produced on request only (APPSTORE_SHOTS_67=1): fastlane 2.238 maps
// 1290x2796 AND 1320x2868 to the SAME slot (deliver/app_screenshot.rb DEVICE_RESOLUTIONS), so uploading both sets
// would put 16 pictures in one 10-picture slot.
const RUN = process.env.RUN_APPSTORE_SHOTS === "1";
const OUT = process.env.APPSTORE_SHOTS_DIR || "e2e-artifacts/appstore";

const DEVICES = [
  { key: "iphone69", css: { width: 440, height: 956 }, scale: 3 },
  { key: "ipad13", css: { width: 1024, height: 1366 }, scale: 2 },
  ...(process.env.APPSTORE_SHOTS_67 === "1" ? [{ key: "iphone67", css: { width: 430, height: 932 }, scale: 3 }] : []),
];

const SUPABASE_HOST = "fncmgoasalhdgfwzhsqa.supabase.co";

// The signed-in member: a made-up name on the happy-path helper account (every account posts and works).
const SHOT_USER: FakeUser = { ...FAKE_HELPER, fullName: "Camille Thibodeaux" };

/*
 * DATES ARE RELATIVE AND created_at IS MORE THAN 20 MINUTES OLD. `useDashboardFilters.ts` drops a job whose
 * `date_needed` is before today, and hides a job younger than the free-tier early-access window (20 minutes,
 * src/lib/earlyAccess.ts) from this viewer. Hardcoded dates emptied this feed once (2026-09-15..21) while the spec
 * kept passing; the `shown.length` check below is what notices if it empties again.
 */
const AGO = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const POSTERS = ["Danielle P.", "Tre B.", "Marie H.", "Eli T.", "Renee G.", "Andre S.", "Lucas M."];
const posterId = (i: number) => `cc000000-0000-4000-8000-00000000000${i + 1}`;

type JobFields = { title: string; category: string; budget: number; parish: string; location: string; latitude: number; longitude: number; date_needed: string; description: string; created_at: string } & Record<string, unknown>;
const job = (i: number, j: JobFields) => ({
  id: `aa000000-0000-4000-8000-00000000000${i + 1}`,
  status: "open", payment_status: "escrow", is_urgent: false, is_group_job: false, helpers_needed: 1,
  credential_tier: 0, is_seed: false, customer_id: posterId(i), start_time: "09:00:00",
  ...j,
});

const FEED_JOBS = [
  job(0, { title: "Mow and edge a corner lot", category: "yard_work", budget: 85, parish: "East Baton Rouge",
    location: "Baton Rouge, LA", latitude: 30.4515, longitude: -91.1871, date_needed: DATE(3),
    description: "Front and back, about a quarter acre. Bagging the clippings preferred.", created_at: AGO(95) }),
  job(1, { title: "Deep clean before move-out", category: "cleaning", budget: 220, parish: "Orleans",
    location: "New Orleans, LA", latitude: 29.9511, longitude: -90.0715, date_needed: DATE(1), start_time: "13:00:00",
    description: "Two bedroom shotgun. Kitchen, bath, floors, and the windows inside.", created_at: AGO(45) }),
  job(2, { title: "Help unloading a moving truck", category: "moving", budget: 140, parish: "Lafayette",
    location: "Lafayette, LA", latitude: 30.2241, longitude: -92.0198, date_needed: DATE(5), start_time: "08:00:00",
    is_group_job: true, helpers_needed: 2,
    description: "26-foot truck to a second floor apartment. About three hours.", created_at: AGO(150) }),
  job(3, { title: "Fix a leaking kitchen faucet", category: "plumbing", budget: 110, parish: "Jefferson",
    location: "Metairie, LA", latitude: 29.9841, longitude: -90.1529, date_needed: DATE(2), start_time: "10:30:00",
    description: "Dripping at the base. The new cartridge is already bought.", created_at: AGO(70) }),
  job(4, { title: "Pressure wash a driveway", category: "pressure_washing", budget: 95, parish: "Ascension",
    location: "Gonzales, LA", latitude: 30.2383, longitude: -90.9201, date_needed: DATE(4), start_time: "11:00:00",
    description: "Concrete drive and front walk. Mildew on the shaded side.", created_at: AGO(115) }),
  job(5, { title: "Assemble a crib and dresser", category: "assembly", budget: 120, parish: "St. Tammany",
    location: "Mandeville, LA", latitude: 30.358, longitude: -90.0653, date_needed: DATE(6), start_time: "14:00:00",
    description: "Both still boxed, instructions inside. Haul the cardboard out after.", created_at: AGO(200) }),
  job(6, { title: "Trim low limbs on two live oaks", category: "yard_work", budget: 260, parish: "Caddo",
    location: "Shreveport, LA", latitude: 32.5252, longitude: -93.7502, date_needed: DATE(8), start_time: "07:30:00",
    description: "Limbs hanging over the shed roof. Bring your own pole saw.", created_at: AGO(260) }),
];
const DETAIL_JOB = FEED_JOBS[1];

// The member's own jobs from the shared seed, kept only where nothing is wrong: no dispute, no fix request, no
// cancellation or failed payment, and not the seed's own "Mow and edge a corner lot" (the feed has one).
const TROUBLE_STATUS = new Set(["disputed", "revision_requested", "cancelled"]);
const TROUBLE_PAYMENT = new Set(["cancelling", "failed", "chargeback", "refunded", "cancelled"]);
const MY_JOBS = (SEED_JOBS as unknown as Record<string, unknown>[]).filter((j) =>
  (j.customer_id === SHOT_USER.id || j.helper_id === SHOT_USER.id) &&
  !TROUBLE_STATUS.has(String(j.status)) && !TROUBLE_PAYMENT.has(String(j.payment_status ?? "")) &&
  j.title !== "Mow and edge a corner lot");

// ── Declutter sample ────────────────────────────────────────────────────────
// Made-up listings from made-up neighbors. Photos are drawn below (an object on a soft tile), so no real member's
// photo is ever shown. Prices are ordinary garage-sale prices (owner 11-01).
const SELLERS = [
  { id: "dd000000-0000-4000-8000-000000000001", name: "Marie H." },
  { id: "dd000000-0000-4000-8000-000000000002", name: "Andre S." },
  { id: "dd000000-0000-4000-8000-000000000003", name: "Renee G." },
];
type Sample = { title: string; category: string; cents: number; area: string; lat: number; lng: number; seller: string; art: string; tint: string; stars?: number; mins: number; desc: string };
const ITEMS_SRC: Sample[] = [
  { title: "Solid oak rocking chair", category: "furniture", cents: 4500, area: "Lafayette", lat: 30.22, lng: -92.02, seller: SELLERS[0].id, art: "🪑", tint: "#efe4d2", stars: 4, mins: 40,
    desc: "Sturdy and smooth. A few scuffs on the arms from years on the porch." },
  { title: "Two fishing rods and a tackle box", category: "hunting_fishing", cents: 4000, area: "Broussard", lat: 30.15, lng: -91.96, seller: SELLERS[1].id, art: "🎣", tint: "#dcebef", stars: 4, mins: 75,
    desc: "Both rods spool fine. Tackle box comes with what's in it." },
  { title: "Kids bike, 20 inch", category: "bikes", cents: 3500, area: "Metairie", lat: 29.98, lng: -90.15, seller: SELLERS[2].id, art: "🚲", tint: "#dfe9f2", stars: 3, mins: 120,
    desc: "Outgrown. Tires hold air, brakes work." },
  { title: "Cast iron skillet, 12 inch", category: "kitchen", cents: 2000, area: "Baton Rouge", lat: 30.45, lng: -91.19, seller: SELLERS[0].id, art: "🍳", tint: "#e7e2dc", stars: 4, mins: 160,
    desc: "Seasoned and smooth. No rust." },
  { title: "Acoustic guitar with case", category: "musical_instruments", cents: 9000, area: "Lafayette", lat: 30.21, lng: -92.03, seller: SELLERS[1].id, art: "🎸", tint: "#f3e7cf", stars: 4, mins: 210,
    desc: "Plays well, new strings last month. Soft case included." },
  { title: "Board games bundle", category: "toys_games", cents: 1500, area: "Youngsville", lat: 30.1, lng: -91.99, seller: SELLERS[2].id, art: "🎲", tint: "#e3efe2", stars: 4, mins: 260,
    desc: "Five games, all pieces counted." },
  { title: "Moving boxes, about 20", category: "moving_supplies", cents: 0, area: "Lafayette", lat: 30.23, lng: -92.01, seller: SELLERS[0].id, art: "📦", tint: "#efe6d8", stars: 3, mins: 300,
    desc: "Free. Mixed sizes, flattened. Come get them." },
  { title: "Table lamp, brass base", category: "home_decor", cents: 2500, area: "Scott", lat: 30.24, lng: -92.09, seller: SELLERS[1].id, art: "💡", tint: "#f4ecd6", stars: 4, mins: 340,
    desc: "Works. Shade has a small mark on the back." },
  { title: "Bookshelf, five shelves", category: "furniture", cents: 3000, area: "Carencro", lat: 30.32, lng: -92.05, seller: SELLERS[2].id, art: "📚", tint: "#ece3d6", stars: 4, mins: 380,
    desc: "Solid wood. Easy to take apart for the car." },
  { title: "Fleur-de-lis wall art", category: "home_decor", cents: 1800, area: "Lafayette", lat: 30.2, lng: -92.01, seller: SELLERS[0].id, art: "⚜️", tint: "#e9e4f0", stars: 4, mins: 420,
    desc: "Metal, about two feet tall. Hanging hook on the back." },
  { title: "Rain boots, size 8", category: "clothing", cents: 1000, area: "Broussard", lat: 30.14, lng: -91.97, seller: SELLERS[1].id, art: "👢", tint: "#f2e6dc", stars: 4, mins: 470,
    desc: "Worn a handful of times." },
  { title: "Youth football", category: "sports_outdoors", cents: 800, area: "Lafayette", lat: 30.22, lng: -92.0, seller: SELLERS[2].id, art: "🏈", tint: "#e6ecdc", stars: 4, mins: 520,
    desc: "Holds air, good grip. Outgrown, not worn out." },
];
// The signed-in member's own listings, for Selling.
const MINE_SRC: Sample[] = [
  { title: "Patio table and four chairs", category: "outdoor_garden", cents: 12000, area: "Lafayette", lat: 30.22, lng: -92.0, seller: SHOT_USER.id, art: "🪴", tint: "#e3ecdf", stars: 4, mins: 90,
    desc: "Aluminum frame, glass top. Cushions included." },
  { title: "Box fan", category: "appliances", cents: 1500, area: "Lafayette", lat: 30.22, lng: -92.0, seller: SHOT_USER.id, art: "🌀", tint: "#dfe8ef", stars: 4, mins: 180,
    desc: "Three speeds, quiet." },
  { title: "Baby swing", category: "baby_kids", cents: 3000, area: "Lafayette", lat: 30.22, lng: -92.0, seller: SHOT_USER.id, art: "🧸", tint: "#f2e3e6", stars: 4, mins: 400,
    desc: "Clean, all parts, runs on batteries or the plug." },
];
const itemId = (i: number) => `ee000000-0000-4000-8000-0000000000${String(10 + i)}`;
const ALL_SRC = [...ITEMS_SRC, ...MINE_SRC];
const ITEMS = ALL_SRC.map((s, i) => ({
  id: itemId(i), seller_id: s.seller, status: "live", title: s.title, description: s.desc, category: s.category,
  condition_stars: s.stars ?? 4, delivery_size: "small", price_cents: s.cents, current_price_cents: s.cents,
  area_label: s.area, area_lat: s.lat, area_lng: s.lng, created_at: AGO(s.mins + 30), live_at: AGO(s.mins),
  porch_ok: true, accepts_offers: s.cents > 0, handovers: ["home", "porch"],
}));
const PHOTOS = ALL_SRC.map((_, i) => ({ id: `ef000000-0000-4000-8000-0000000000${String(10 + i)}`, item_id: itemId(i), storage_path: `sample/${itemId(i)}.svg`, position: 0 }));
const DETAIL_ITEM = ITEMS[0];

/** A listing photo: the object, large, on a soft tile. Served for every storage URL (public and transformed). */
function photoSvg(path: string): string {
  const i = PHOTOS.findIndex((p) => path.includes(p.item_id));
  const s = ALL_SRC[i] ?? { art: "📦", tint: "#eee" };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">` +
    `<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#ffffff" stop-opacity=".75"/><stop offset="1" stop-color="${s.tint}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="960" height="960" fill="${s.tint}"/><rect width="960" height="960" fill="url(#g)"/>` +
    `<ellipse cx="480" cy="760" rx="260" ry="34" fill="#000" opacity=".07"/>` +
    `<text x="480" y="600" font-size="460" text-anchor="middle" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${s.art}</text></svg>`;
}

const SEEDED_POSTER = "00000000-0000-4000-8000-00000000c1ce"; // the shared seed's poster (home's live job)
const PROFILES = [
  { id: SEEDED_POSTER, user_id: SEEDED_POSTER, first_name: "Lucas", last_name: "M.", full_name: "Lucas M.", avatar_url: null, location: "Lafayette, LA" },
  ...SELLERS.map((s) => ({ id: s.id, user_id: s.id, first_name: s.name.split(" ")[0], last_name: s.name.split(" ")[1], full_name: s.name, avatar_url: null, location: "Lafayette, LA" })),
  ...FEED_JOBS.map((j, i) => ({ id: j.customer_id, user_id: j.customer_id, first_name: POSTERS[i].split(" ")[0], last_name: POSTERS[i].split(" ")[1], full_name: POSTERS[i], avatar_url: null, location: j.location })),
];

const msg = (n: number, jobIdx: number, fromMe: boolean, content: string, minsAgo: number, read = true) => ({
  id: `3f000000-0000-4000-8000-0000000000${String(10 + n)}`, job_id: FEED_JOBS[jobIdx].id,
  sender_id: fromMe ? SHOT_USER.id : FEED_JOBS[jobIdx].customer_id, receiver_id: fromMe ? FEED_JOBS[jobIdx].customer_id : SHOT_USER.id,
  content, created_at: AGO(minsAgo), read, is_system: false,
});
const MESSAGES = [
  msg(0, 1, false, "Hi! Can you bring your own vacuum? Mine just quit.", 6, false),
  msg(1, 1, true, "Yes, I'll bring mine. Is 1:00 still good?", 25),
  msg(2, 3, true, "I can come by Wednesday morning for the faucet.", 70),
  msg(3, 3, false, "Perfect, I'll leave the cartridge on the counter.", 55),
  msg(4, 4, false, "The hose bib is on the left side of the house.", 180),
  msg(5, 2, true, "I can be one of the two. What time is the truck arriving?", 300),
];

// The switches that are on for EVERYONE on prod (public.feature_switches, read 2026-11-02). Anything a regular member
// cannot see (memberships, quotes, rentals, shops, shipping, instant book) stays off, so no shot shows it.
const LIVE_SWITCHES = Object.fromEntries([
  "applicant_proof", "card_hold_at_post", "checkout_nudge", "come_back_emails", "confirm_reminders", "declutter",
  "declutter_add_helpr", "declutter_haul_away", "declutter_moving_out", "declutter_price_hint", "declutter_refund_requests",
  "declutter_seller_delivery", "declutter_wanted", "identity_check", "job_reach", "payout_after_hire", "payout_setup",
  "price_guidance", "scanner_safe_confirm_links", "sms_alerts",
].map((k) => [k, true]));

function rules(): MockRule[] {
  return [
    mockRpc("feature_switches_for_me", LIVE_SWITCHES),
    // No stars or review counts anywhere: a made-up rating on a product page would be a fake review.
    mockRpc("get_public_profile_stats", []),
    mockRpc("declutter_visible_reviews", []),
    mockTable("open_jobs_browse", FEED_JOBS, { honorFilters: true }),
    // `jobs` answers only the jobs this member is a party to, as RLS does: the feed's jobs come from open_jobs_browse,
    // so the job page treats the viewer as a Helpr who can apply (a jobs row would make them a party, with no Apply).
    mockTable("jobs", MY_JOBS, { honorFilters: true }),
    mockRpc("get_message_thread_job_titles", FEED_JOBS.map((j) => ({ job_id: j.id, title: j.title }))),
    // Nothing that reads as a problem on Home: no disputes, no fix requests.
    mockTable("disputes", []),
    mockTable("job_revisions", []),
    mockTable("declutter_items", ITEMS, { honorFilters: true }),
    mockTable("declutter_item_photos", PHOTOS, { honorFilters: true }),
    // Every made-up person, whichever ids were asked for (the client keys by id, so extras are harmless).
    mockRpc("get_safe_profiles", PROFILES),
    mockTable("profiles_public", PROFILES, { honorFilters: true }),
    // Sample threads with recent times (the shared seed's are dated 2026-08-14).
    mockTable("messages", MESSAGES, { honorFilters: true }),
    // No gift card banner on Post a job: the shared seed gives this member two.
    mockTable("gift_cards", []),
    { match: (u) => u.pathname.startsWith("/storage/v1/"),
      handle: (u) => ({ status: 200, body: photoSvg(u.pathname), headers: { "content-type": "image/svg+xml" } }) },
  ];
}

const SHOTS = [
  { slug: "01-home", url: "/home", wait: "" },
  { slug: "02-jobs", url: "/jobs", wait: FEED_JOBS[0].title },
  { slug: "03-job", url: `/jobs/${DETAIL_JOB.id}`, wait: DETAIL_JOB.title },
  { slug: "04-post-job", url: "/post-job", wait: "" },
  { slug: "05-declutter", url: "/declutter", wait: ITEMS_SRC[0].title },
  { slug: "06-declutter-item", url: `/declutter/item/${DETAIL_ITEM.id}`, wait: DETAIL_ITEM.title },
  { slug: "07-selling", url: "/declutter?tab=selling", wait: MINE_SRC[0].title },
  { slug: "08-messages", url: "/messages", wait: "" },
];

/**
 * Proof, per shot, that the live backend was never reached: every response from the Supabase host must have been
 * answered by page.route (Playwright gives a fulfilled response no server address), and none may come from a
 * service worker (the happy-path project blocks them; this checks it held).
 */
function watchBackend(page: import("@playwright/test").Page) {
  const reached: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r) => {
    if (!r.url().includes(SUPABASE_HOST)) return;
    pending.push((async () => {
      const addr = await r.serverAddr().catch(() => null);
      if (addr || r.fromServiceWorker()) reached.push(`${r.request().method()} ${r.url()}`);
    })());
  });
  return async () => {
    await Promise.all(pending);
    expect(reached, "a request reached the live backend").toEqual([]);
  };
}

for (const device of DEVICES) {
  test.describe(device.key, () => {
    // A Lafayette location, so Declutter shows distances instead of asking for the location.
    test.use({ deviceScaleFactor: device.scale, geolocation: { latitude: 30.2241, longitude: -92.0198 }, permissions: ["geolocation"] });

    for (const shot of SHOTS) {
      test(`screenshot ${shot.slug}`, async ({ page, context, baseURL }) => {
        test.skip(!RUN, "opt-in: set RUN_APPSTORE_SHOTS=1 (see the note above)");
        test.setTimeout(60_000);
        await seedAuthedSession(context, SHOT_USER, baseURL ?? "");
        await installSupabaseMocks(page, { user: SHOT_USER, seed: true, rules: rules() });
        const checkBackend = watchBackend(page);
        await page.addInitScript(() => {
          try {
            localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
            localStorage.setItem("helpr_welcomed", "1");
          } catch { /* no-storage guard */ }
        });
        await page.setViewportSize(device.css);
        await page.goto(shot.url);
        await page.waitForTimeout(2500);

        // MapKit JS cannot load offline, so a map panel would show "The map isn't available right now". Use the list.
        const listToggle = page.getByRole("button", { name: /list view|show list|hide the map/i }).first();
        if (await listToggle.isVisible().catch(() => false)) {
          await listToggle.click().catch(() => {});
          await page.waitForTimeout(1200);
        }

        // Declutter asks before it uses the location; the context already granted it (Lafayette), so take the offer.
        const useLocation = page.getByRole("button", { name: "Use my location" }).first();
        if (await useLocation.isVisible().catch(() => false)) {
          await useLocation.click().catch(() => {});
          await page.waitForTimeout(1200);
        }

        if (shot.wait) {
          await expect(page.getByText(shot.wait, { exact: false }).first(), `${shot.slug} never rendered ${JSON.stringify(shot.wait)}`)
            .toBeVisible({ timeout: 10_000 });
        }
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);

        const text = (await page.textContent("body")) ?? "";
        expect(text, `${shot.slug} shows an error banner`).not.toMatch(/isn't available right now|something went wrong|couldn't load/i);
        expect(text.trim().length, `${shot.slug} rendered almost nothing`).toBeGreaterThan(80);
        expect(text, `${shot.slug} is a login screen`).not.toMatch(/Forgot Password\?/i);
        if (shot.url === "/jobs") {
          // POPULATED, not merely non-empty: the empty feed also clears the checks above.
          const shown = FEED_JOBS.filter((j) => text.includes(j.title));
          expect(shown.length, `${shot.slug} captured an EMPTY FEED; every FEED_JOBS date_needed must be DATE(n)`).toBeGreaterThan(0);
        }

        // JPEG at quality 70: full resolution, no alpha, and small enough for git (scripts/check-asset-weight.mjs).
        await page.screenshot({ path: `${OUT}/${device.key}-${shot.slug}.jpg`, type: "jpeg", quality: 70, fullPage: false });
        await checkBackend();
      });
    }
  });
}

// The write probe: a Declutter write sent from the page is answered by the mock and never leaves the machine. The
// live backend would refuse this fake session (401); the mock answers 200 with no server address.
test("screenshot write probe: writes never reach the backend", async ({ page, context, baseURL }) => {
  test.skip(!RUN, "opt-in: set RUN_APPSTORE_SHOTS=1 (see the note above)");
  await seedAuthedSession(context, SHOT_USER, baseURL ?? "");
  await installSupabaseMocks(page, { user: SHOT_USER, seed: true, rules: rules() });
  await page.goto("/home");
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rpc/declutter_create_item")),
    page.evaluate(async (host) => {
      await fetch(`https://${host}/rest/v1/rpc/declutter_create_item`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }, SUPABASE_HOST),
  ]);
  expect(await resp.serverAddr(), "the write reached a server").toBeNull();
  expect(resp.status()).toBe(200);
  expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null), "a service worker controls the page").toBeNull();
});

// Proof this spec can fail. The defect it exists to catch is a feed that silently EMPTIES while the spec stays
// green, which is what happened for six days when the FEED_JOBS `date_needed` literals expired. With `<` flipped to
// `>` the filter drops every FUTURE-dated job, and the `shown.length` assertion is what notices.
// @mutate src/hooks/useDashboardFilters.ts | job.date_needed.slice(0, 10) < todayLocalDate | job.date_needed.slice(0, 10) > todayLocalDate
