// Mint really-funded is_seed jobs on prod, paid on Stripe TEST mode with
// 4242 4242 4242 4242 through the real hosted Checkout (headless Chromium),
// exactly the way e2e/prod-lifecycle.spec.ts funds its job.
//
//   node scripts/probes/mint-funded-seed-jobs.prod.mjs <n> <out-file>
//   node scripts/probes/mint-funded-seed-jobs.prod.mjs --listings <out-file>
//
// Each line of <out-file> is "<jobId> <paymentIntentId>".
// Refuses to pay anything but a cs_test_ session.
//
// TWO MODES, because a funded job is wanted for two unrelated reasons.
//
// RACE MODE (default, `<n> <out-file>`)
// -------------------------------------
// The job is left payment_status=escrow with a real succeeded PI, for money
// race probes (admin-dispute-race.prod.mjs) that need a capture to refund or
// transfer from. It is HIRED to the seed helper immediately, so it stops being
// `open` and stops consuming one of the poster's five open-job slots. Those
// rows are deliberately NOT visible to a guest.
//
// LISTING MODE (`--listings <out-file>`)
// --------------------------------------
// Supply for the SIGNED-OUT MARKETPLACE. The job stays `open` + `escrow`,
// which is exactly the predicate `open_jobs_browse` admits:
//
//     status = 'open' AND customer_id IS NOT NULL
//     AND payment_status = ANY ('escrow','payout_pending','released')
//
// WHY IT EXISTS. On 2026-09-16 05:00:00.745 the guest marketplace went dark.
// Every open funded listing on prod was a hand-seeded fixture with a FIXED,
// SOON `date_needed`, and `auto-expire-jobs` (cron jobid 16, hourly at :00)
// cancels an open job once its scheduled date has passed — correctly; that is
// the product rule. They aged out in PAIRS (09-14 18:00, 09-15 05:00) and the
// last pair took browse to zero in a single cron tick, 86 minutes after a green
// CI run on the same SHA. `E2E real backend`'s anon leg then stayed red for
// three days (#1617), and 115 `open` jobs remained — every one of them
// `payment_status='abandoned'`, i.e. invisible to everybody.
//
// Owner decision 2026-09-19: mint fresh funded listings with future dates,
// the same way the previous funded listings existed. `scripts/audit/prod-seed.mjs`
// deliberately writes `payment_status='unpaid'` and therefore cannot be the
// tool for this — an unpaid job appears to no one.
//
// TWO THINGS THE DEAD FIXTURES GOT WRONG, BOTH FIXED HERE:
//
//   1. THE HORIZON WAS DAYS. LISTINGS below are dated a MONTH out at the
//      nearest. The shortest runway any listing carries is +31 days, which is
//      more than ten times the 3-day warning `scripts/ci/guest-listing-horizon.mjs`
//      gives and far longer than the longest gap between that check's runs
//      (it runs on every push to main plus Sun/Mon/Wed/Fri — a 2-day maximum).
//      A month also means nobody has to think about the marketplace between
//      now and launch.
//
//   2. THEY EXPIRED TOGETHER. The dates below are spaced ~14 days apart, so at
//      most ONE listing ages out at a time and the marketplace thins gradually
//      instead of switching off. Clustering is what turned an expiry into an
//      outage: two rows shared a `date_needed` and one cron tick took browse
//      from two listings to none.
//
// THE POSTERS ARE SPREAD over three seeded accounts, three/three/two, because
// `enforce_open_job_limit()` caps each poster at FIVE open funded jobs. The
// fourth seeded account, `poster-e2e` (71c56dfb, "Perry Poster"), is
// deliberately left EMPTY: it is the account `e2e/prod-lifecycle.spec.ts`
// posts and funds from on every nightly money loop, and filling its slots
// would turn this fix into a different red build.
//
// CLEANUP: every row is `is_seed = true`. To remove what this minted, refund
// and delete by the ids in <out-file> — see the file's own header line.
import { appendFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { rest, session, invoke } from "./lib/prodEnv.mjs";

const argv = process.argv.slice(2);
const LISTING_MODE = argv[0] === "--listings";
const [nArg, out] = LISTING_MODE ? [null, argv[1]] : argv;
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const SEED_HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

/**
 * The guest marketplace, as a guest should find it.
 *
 * `date_needed` is expressed as DAYS FROM THE RUN, not a stamped date, so this
 * file cannot itself become the next stale fixture: re-running it in November
 * mints November-relative dates. `days` are ~14 apart for the reason in the
 * header. Coordinates are the real city centroids the previous funded
 * fixtures used, so the browse map has pins rather than an empty state.
 */
const LISTINGS = [
  { account: "poster", days: 31, category: "cleaning", budget: 185,
    title: "Deep clean a 3-bed before move-in",
    description: "Empty house, needs a full turnover clean: floors, baseboards, inside cabinets, both bathrooms, oven and fridge. Keys in the lockbox, code sent after hiring.",
    location: "Baton Rouge, LA", parish: "East Baton Rouge", latitude: 30.4515, longitude: -91.1871 },
  { account: "helper-e2e", days: 45, category: "yard_work", budget: 165,
    title: "Trim crepe myrtles and haul the limbs",
    description: "Four crepe myrtles along the driveway plus one hedge line. Bring your own loppers; haul-off is included in the price.",
    location: "New Iberia, LA", parish: "Iberia", latitude: 30.0035, longitude: -91.8187 },
  { account: "helper", days: 59, category: "assembly", budget: 140,
    title: "Assemble a swing set in the backyard",
    description: "Boxed swing set with instructions included. The ground is already level and cleared, and there is power at the patio for tools.",
    location: "Lafayette, LA", parish: "Lafayette", latitude: 30.1926, longitude: -92.0454 },
  { account: "poster", days: 73, category: "moving", budget: 240,
    title: "Two-person crew for a one-bedroom move",
    description: "Second-floor walk-up to a ground-floor unit about fifteen minutes away. Everything is boxed; the truck is already rented.",
    location: "New Orleans, LA", parish: "Orleans", latitude: 29.9511, longitude: -90.0715 },
  { account: "helper-e2e", days: 88, category: "painting", budget: 195,
    title: "Touch up the hallway and stairwell",
    description: "Small patch and repaint after some drywall work. Paint is already matched and on site, drop cloths provided.",
    location: "Shreveport, LA", parish: "Caddo", latitude: 32.5252, longitude: -93.7502 },
  { account: "helper", days: 102, category: "handyman", budget: 120,
    title: "Clean the gutters and reseat one downspout",
    description: "Single-storey ranch, gutters all the way around, plus one downspout that has pulled away from the wall. Ladder available if you need it.",
    location: "Lake Charles, LA", parish: "Calcasieu", latitude: 30.2266, longitude: -93.2174 },
  { account: "poster", days: 117, category: "delivery", budget: 110,
    title: "Pick up and deliver a washer",
    description: "Appliance is on the curb and a dolly is provided. Ten-minute drive, ground floor at both ends, no stairs either side.",
    location: "Houma, LA", parish: "Terrebonne", latitude: 29.5958, longitude: -90.7195 },
  { account: "helper-e2e", days: 131, category: "events", budget: 210,
    title: "Setup crew for a backyard reception",
    description: "Tables, chairs and string lights from noon, then help striking everything down after ten. Two people would be ideal but one is fine.",
    location: "Alexandria, LA", parish: "Rapides", latitude: 31.3113, longitude: -92.4451 },
];

if (LISTING_MODE) {
  if (!out) { console.error("usage: --listings <out-file>"); process.exit(2); }
} else if (!Number(nArg) || !out) {
  console.error("usage: <n> <out-file>   |   --listings <out-file>");
  process.exit(2);
}
const N = LISTING_MODE ? LISTINGS.length : Number(nArg);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);

/** Louisiana's civil date `days` out — the zone `auto-expire-jobs` judges in. */
function centralDatePlus(days) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** One access token per seeded account, minted once and reused. */
const tokens = new Map();
function tokenFor(account) {
  if (!tokens.has(account)) tokens.set(account, session(account).access_token);
  return tokens.get(account);
}
const ACCOUNT_IDS = {
  poster: "96c9899e-87a2-49e2-bbdd-268717d52aee",
  helper: "f6cc3ebb-9478-473c-8eb8-62b406f0734f",
  "poster-e2e": POSTER,
  "helper-e2e": SEED_HELPER,
};

/** The row to insert for attempt #`made`, in whichever mode is running. */
function jobBody(made) {
  if (!LISTING_MODE) {
    return {
      account: "poster-e2e",
      body: {
        customer_id: POSTER, is_seed: true, parish: null,
        title: `RACE-FUNDED seed ${tag()}`, description: "funded fixture for a money race probe",
        category: "cleaning", location: "Baton Rouge, LA",
        date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        budget: 20, status: "open", payment_status: "unpaid", pricing_mode: "set_price",
      },
    };
  }
  const l = LISTINGS[made];
  return {
    account: l.account,
    body: {
      customer_id: ACCOUNT_IDS[l.account], is_seed: true, parish: l.parish,
      title: l.title, description: l.description, category: l.category,
      location: l.location, latitude: l.latitude, longitude: l.longitude,
      date_needed: centralDatePlus(l.days),
      budget: l.budget, status: "open", payment_status: "unpaid", pricing_mode: "set_price",
    },
  };
}

if (LISTING_MODE) {
  writeFileSync(out, "# jobId paymentIntentId — is_seed guest-marketplace listings; refund the PI and DELETE the job to undo\n");
  console.log("LISTING MODE — jobs stay `open` + `escrow` so open_jobs_browse admits them.");
  for (const l of LISTINGS) {
    console.log(`  +${String(l.days).padStart(3)}d  ${centralDatePlus(l.days)}  ${l.account.padEnd(11)} $${String(l.budget).padEnd(4)} ${l.title}`);
  }
  console.log("");
}

const browser = await chromium.launch();
let made = 0;
try {
  while (made < N) {
    const { account, body } = jobBody(made);
    const posterTok = tokenFor(account);
    const [job] = await rest("jobs", { method: "POST", prefer: "return=representation", body });
    const esc = await invoke("create-payment", posterTok, { action: "escrow", jobId: job.id });
    if (esc.status === 429) { await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" }); await sleep(60_000); continue; }
    const url = esc.json?.url;
    // THE TEST-MODE GUARD. A live Stripe key mints `cs_live_`; this refuses to
    // type a card number into anything but `cs_test_`. Stripe stays in sandbox
    // until launch (owner standing order) and this is where that is enforced.
    if (!url || !String(url).includes("cs_test_")) {
      await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
      throw new Error(`refusing: escrow returned ${esc.status} ${JSON.stringify(esc.json).slice(0, 200)}`);
    }
    console.log(`  checkout session is TEST mode (cs_test_): ${String(url).split("/").pop().slice(0, 28)}…`);
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const card = page.locator("#cardNumber");
      const radio = page.getByRole("radio").first();
      await card.or(radio).first().waitFor({ state: "visible", timeout: 60_000 });
      if (!(await card.isVisible().catch(() => false))) await radio.click({ force: true });
      await card.waitFor({ state: "visible", timeout: 30_000 });
      await card.fill("4242 4242 4242 4242");
      await page.locator("#cardExpiry").fill("12 / 34");
      await page.locator("#cardCvc").fill("123");
      for (const [id, v] of [["#billingName", "Race Probe"], ["#billingAddressLine1", "100 Audit Way"], ["#billingLocality", "Baton Rouge"], ["#billingPostalCode", "70801"]]) {
        const f = page.locator(id);
        if ((await f.count()) && (await f.isVisible().catch(() => false))) { await f.fill(v).catch(() => {}); await page.keyboard.press("Escape").catch(() => {}); }
      }
      const link = page.locator("#enableStripePass");
      if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true }).catch(() => {});
      await page.getByTestId("hosted-payment-submit-button").click();
      await page.waitForURL((u) => !u.host.endsWith("checkout.stripe.com"), { timeout: 120_000 });
    } catch (e) {
      // The webhook, not the redirect, is the authority — poll below decides.
      console.log(`  checkout wait for ${job.id}: ${String(e.message).split("\n")[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
    let row;
    for (let t = 0; t < 30; t++) {
      [row] = await rest(`jobs?id=eq.${job.id}&select=payment_status,status,date_needed,expires_at,stripe_payment_intent_id`);
      if (row.payment_status === "escrow" && row.stripe_payment_intent_id) break;
      await sleep(2000);
    }
    if (row.payment_status !== "escrow" || !row.stripe_payment_intent_id) {
      console.log(`  not funded, discarding ${job.id}: ${JSON.stringify(row)}`);
      await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
      continue;
    }
    if (LISTING_MODE) {
      // Deliberately NOT hired. `open` is half the predicate `open_jobs_browse`
      // admits, and this row exists to be seen by a signed-out visitor.
      // `expires_at` is asserted NULL because auto-expire-jobs consults it
      // INSTEAD of `date_needed` when it is set — a stamped expiry would
      // silently undo the month of runway the date above buys.
      if (row.expires_at) throw new Error(`listing ${job.id} carries expires_at=${row.expires_at}, which overrides the ${row.date_needed} horizon`);
      if (row.status !== "open") throw new Error(`listing ${job.id} landed status=${row.status}, not open — it will not reach browse`);
    } else {
      // Off the open-job cap (5 per poster): hire the seed helper right away.
      await rest(`jobs?id=eq.${job.id}`, {
        method: "PATCH",
        body: { status: "accepted", helper_id: SEED_HELPER, accepted_at: new Date().toISOString() },
      });
    }
    appendFileSync(out, `${job.id} ${row.stripe_payment_intent_id}\n`);
    made++;
    console.log(`funded ${made}/${N}: ${job.id} ${row.stripe_payment_intent_id}${LISTING_MODE ? `  open, date_needed=${row.date_needed}` : ""}`);
    await sleep(7_000); // stay under create-payment's 10/min per user
  }
} finally {
  await browser.close();
}
