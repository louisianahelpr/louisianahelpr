#!/usr/bin/env node
/**
 * TEST LAB (owner 2026-11-09): test data in every state for the Cowork follow-up
 * audit, on the two shared e2e test accounts only.
 *
 *   node --env-file=.env scripts/test-lab/seed-test-lab.mjs --apply             build every lab row (idempotent per row)
 *   node --env-file=.env scripts/test-lab/seed-test-lab.mjs --verify            read-only; one line per lab row with its live state
 *   node --env-file=.env scripts/test-lab/seed-test-lab.mjs --teardown --dry-run   list every row teardown would delete
 *   node --env-file=.env scripts/test-lab/seed-test-lab.mjs --teardown          delete everything this script created
 *   add --json=<file> to --apply/--verify to write the row list (LAB.md is built from it)
 *
 * ACCOUNTS (both is_seed AND enrolled in public.test_accounts; checked before any write):
 *   P = helpr-e2e-poster-0902 ("poster-e2e"): posts the hired-and-later jobs; Declutter SELLER.
 *   H = helpr-e2e-helper-0902 ("helper-e2e"): the hired Helpr; Declutter BUYER (it holds the saved
 *       TEST-mode card offers need); and it posts the two OPEN jobs, so P's five-open-paid-job cap
 *       stays free for the nightly journeys (P already holds 4 counted open jobs, 2026-11-09).
 *
 * WHY NO MONEY CAN MOVE (same model as scripts/e2e/seedStateFixtures.mjs, Q946):
 *   - jobs: payment_status 'escrow' with NO stripe_session_id / stripe_payment_intent_id; every money
 *     mover refuses that shape, and the money crons skip is_seed.
 *   - Declutter orders: inserted with NO Checkout Session and NO PaymentIntent. No declutter_payouts row
 *     is ever written pending/failed (declutter_payouts_due does not skip seed), only 'succeeded' for the
 *     finished sale; every declutter_refunds row is written 'succeeded' (declutter_refunds_due reads only
 *     pending/failed). Deadlines that a sweep would act on (refund answer_by, problem decide_by, cart
 *     checkout_by, booking slots) are set days out, so nothing ages into a refund or a strike before teardown.
 *   - Stripe is LIVE: nothing here calls Stripe or an edge function.
 *
 * HIDDEN FROM REAL PEOPLE AND THE OWNER: every row is is_seed (the seed triggers force it from the
 * test accounts); seed_hidden_in_discovery() hides seed listings/jobs from everyone but test accounts
 * (admins included); owner_daily_summary_stats and the job/item broadcast notifiers skip is_seed.
 *
 * TITLES start "SEED TEST " (press-every-control never mutates a SEED row; the e2e sweepers select by
 * other markers). Row ids are UUID v5 (pressProdSafety.isSeedRowId), namespace lh-test-lab-1109.
 */
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUPABASE_URL, PUBLIC_ANON_KEY, mintAdminSession } from "../lib/adminSession.mjs";
import { supabaseBase } from "../lib/apiBase.mjs";
import { ACCOUNTS } from "../test-signin-link.mjs";

export const P = { key: "P", email: ACCOUNTS["poster-e2e"].email, userId: ACCOUNTS["poster-e2e"].userId };
export const H = { key: "H", email: ACCOUNTS["helper-e2e"].email, userId: ACCOUNTS["helper-e2e"].userId };
const ADDRESS = "2000 Johnston St, Lafayette, LA 70503";
const POINT = { lat: 30.2096, lng: -92.0306 };
const WWW = "https://www.louisianahelpr.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Chicago";
const PHOTO_BUCKET = "job-photos"; // DECLUTTER_PHOTO_BUCKET (src/lib/declutter/api.ts)
const HANDOVER_BUCKET = "declutter-handover";
/**
 * declutter_refunds needs a pi_ id unless the whole refund went to a gift balance. The lab's refund rows are
 * written 'succeeded' (never read by declutter_refunds_due) and carry this marker, which names no Stripe object.
 */
const LAB_PI = "pi_TESTLAB_no_stripe_object";
/** Ids of the notices --apply's own writes produced for P and H (teardown deletes them too). Outside the repo. */
const MANIFEST = process.env.LAB_MANIFEST || join(homedir(), ".lh-shots/test-lab-1109/manifest.json");
/** Placeholder photos rendered by scripts/test-lab/render-lab-photos.mjs (one <key>.jpg per listing, plus set-out.jpg). */
const PHOTO_DIR = process.env.LAB_PHOTO_DIR || join(homedir(), ".lh-shots/test-lab-1109/photos");

export function labId(key) {
  const h = crypto.createHash("sha1").update(`lh-test-lab-1109:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// ── Central time ────────────────────────────────────────────────────────────
function centralDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function centralHour(ms) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(ms)));
}
/** date + start time a few hours ahead today (Central), rolling to tomorrow 09:00 late in the evening. */
function laterToday(now, hoursAhead = 3) {
  const t = now + hoursAhead * HOUR;
  if (centralDate(t) !== centralDate(now) || centralHour(t) > 21) return { date_needed: centralDate(now + DAY), start_time: "09:00:00" };
  return { date_needed: centralDate(t), start_time: `${String(centralHour(t)).padStart(2, "0")}:00:00` };
}

// ── the lab ────────────────────────────────────────────────────────────────
/**
 * Jobs. `poster`/`helper` are the accounts; `to` is the state the build drives it to.
 * `safe` says what Cowork may do on it.
 */
export const JOBS = [
  { key: "open-test", poster: H, helper: null, to: "open", title: "SEED TEST Hang three shelves", category: "handyman", budget: 85, label: "Open, no applicants: the TEST open job", safe: "Cowork MAY apply to this one as P (the apply sheet, and submitting). Withdraw the application afterwards." },
  { key: "open-applicants", poster: H, helper: P, to: "applied", title: "SEED TEST Wash two cars", category: "cleaning", budget: 70, label: "Open, applicant waiting (P applied)", safe: "Look only. Do not hire." },
  { key: "hired", poster: P, helper: H, to: "hired", title: "SEED TEST Pressure wash a patio", category: "cleaning", budget: 140, label: "Hired (starts in 4 days)", safe: "Look, open the cancel sheet, stop before confirming." },
  { key: "confirmed", poster: P, helper: H, to: "confirmed", title: "SEED TEST Assemble a bookshelf", category: "assembly", budget: 90, label: "Confirmed for tomorrow (both confirmed)", safe: "Look only." },
  { key: "on-the-way", poster: P, helper: H, to: "on_the_way", title: "SEED TEST Mow a front lawn", category: "yard_work", budget: 60, label: "Helpr on the way", safe: "Look only." },
  { key: "arrived", poster: P, helper: H, to: "arrived", title: "SEED TEST Clean out a garage", category: "cleaning", budget: 150, label: "Helpr arrived (GPS verified)", safe: "Look only." },
  { key: "working", poster: P, helper: H, to: "working", title: "SEED TEST Paint a fence", category: "painting", budget: 180, label: "Working (poster confirmed work started)", safe: "Look only." },
  { key: "continue-day", poster: P, helper: H, to: "continue_day", title: "SEED TEST Lay garden pavers", category: "yard_work", budget: 220, label: "Continue another day (agreed for the day after tomorrow)", safe: "Look only." },
  { key: "done-awaiting", poster: P, helper: H, to: "done", title: "SEED TEST Haul brush to the curb", category: "yard_work", budget: 75, label: "Done, waiting for the poster's approval", safe: "Look only. Do not approve." },
  { key: "revision", poster: P, helper: H, to: "revision", title: "SEED TEST Scrub a back deck", category: "cleaning", budget: 110, label: "Revision requested (fix asked for)", safe: "Look only." },
  { key: "approved-paid", poster: P, helper: H, to: "approved", title: "SEED TEST Trim the hedges", category: "yard_work", budget: 95, label: "Approved and paid (database only, no Stripe)", safe: "Look; the review screen may be opened but do not submit a review." },
  { key: "cancelled-early", poster: P, helper: H, to: "cancelled_early", title: "SEED TEST Move a dresser", category: "moving", budget: 80, label: "Cancelled early by the poster (no fee)", safe: "Look only." },
  { key: "cancelled-late", poster: P, helper: H, to: "cancelled_late", title: "SEED TEST Clean gutters", category: "cleaning", budget: 120, label: "Cancelled late by the poster (late fee kept by the Helpr)", safe: "Look only." },
  { key: "expired", poster: P, helper: null, to: "expired", title: "SEED TEST Fix a squeaky door", category: "handyman", budget: 50, label: "Expired (listing ran out, nobody hired)", safe: "Look only." },
  { key: "disputed", poster: P, helper: H, to: "disputed", title: "SEED TEST Regrout a tub surround", category: "handyman", budget: 170, label: "Disputed (poster opened a dispute after Done)", safe: "Look only." },
];

/** Declutter listings. seller P unless noted. `price` in cents. */
export const ITEMS = [
  { key: "test-listing", title: "SEED TEST Wooden step stool (TEST listing)", price: 1500, status: "live", label: "TEST listing (live, takes offers and trades)", safe: "Cowork MAY make offers (10%, 20%, Custom), open Buy now up to the Stripe page (never pay), message the seller, and save it." },
  { key: "test-free", title: "SEED TEST Box of mason jars (TEST free item)", price: 0, status: "live", label: "TEST free item", safe: "Cowork MAY request it and pick a time; withdraw the request afterwards." },
  { key: "offer-open", title: "SEED TEST Table lamp", price: 2000, status: "live", label: "Offer open (waiting on the seller)" },
  { key: "offer-countered", title: "SEED TEST Throw pillows (pair)", price: 1800, status: "live", label: "Offer countered (waiting on the buyer)" },
  { key: "offer-accepted", title: "SEED TEST Picture frame set", price: 2400, status: "live", label: "Offer accepted (in the buyer's cart to check out)" },
  { key: "offer-declined", title: "SEED TEST Desk organizer", price: 1200, status: "live", label: "Offer declined" },
  { key: "offer-expired", title: "SEED TEST Woven basket", price: 1600, status: "live", label: "Offer expired" },
  { key: "trade-want", title: "SEED TEST Cast iron skillet", price: 2500, status: "live", label: "Trade target (open trade offer)", trades: true },
  { key: "trade-accepted-want", title: "SEED TEST Camping lantern", price: 2200, status: "live", label: "Trade target (accepted trade)", trades: true },
  { key: "trade-lapsed-want", title: "SEED TEST Board game", price: 1500, status: "live", label: "Trade target (lapsed trade)", trades: true },
  { key: "trade-give-1", seller: H, title: "SEED TEST Bluetooth speaker", price: 2500, status: "live", label: "H's item offered in the open trade", trades: true },
  { key: "trade-give-2", seller: H, title: "SEED TEST Yoga mat", price: 2000, status: "live", label: "H's item offered in the accepted trade", trades: true },
  { key: "trade-give-3", seller: H, title: "SEED TEST Puzzle (1000 pieces)", price: 1400, status: "live", label: "H's item offered in the lapsed trade", trades: true },
];

/** Declutter orders: buyer H, seller P, one item each. */
export const ORDERS = [
  { key: "o-paid-to-book", title: "SEED TEST Ceramic planter", price: 1200, handover: "porch", label: "Paid, porch pickup still to book" },
  { key: "o-booked", title: "SEED TEST Floor mirror", price: 3500, handover: "pickup_home", label: "Pickup booked (in 2 days)" },
  { key: "o-porch-photo", title: "SEED TEST Bar stools (pair)", price: 4000, handover: "porch", label: "Porch photo added by the seller (set out)" },
  { key: "o-picked-up", title: "SEED TEST Kids bike", price: 3000, handover: "porch", label: "Picked up (buyer's 24-hour check window open)" },
  { key: "o-delivery", title: "SEED TEST Accent chair", price: 4500, handover: "seller_delivery", delivery: 500, label: "Seller delivery booked (in progress)" },
  { key: "o-completed", title: "SEED TEST Coffee table", price: 5000, handover: "pickup_home", label: "Completed (sale final, seller paid; database only)" },
  { key: "o-buyer-cancelled", title: "SEED TEST Rain boots", price: 1500, handover: "porch", label: "Buyer cancelled before pickup (refunded, card fee kept)" },
  { key: "o-refund-requested", title: "SEED TEST Air fryer", price: 3500, handover: "pickup_home", label: "Refund requested (waiting on the seller)" },
  { key: "o-refund-partial", title: "SEED TEST Area rug", price: 6000, handover: "pickup_home", label: "Partly refunded (seller offered part, buyer agreed)" },
  { key: "o-refund-declined", title: "SEED TEST Blender", price: 2500, handover: "pickup_home", label: "Refund declined by the seller" },
  { key: "o-problem", title: "SEED TEST Office chair", price: 4000, handover: "pickup_home", label: "Problem reported (open, with Helpr)" },
];

// ── REST plumbing ───────────────────────────────────────────────────────────
function client({ supabaseUrl = DEFAULT_SUPABASE_URL, serviceKey }) {
  const base = supabaseBase(supabaseUrl).replace(/\/+$/, "");
  const call = async (method, pathAndQuery, body, { token, prefer = "return=representation" } = {}) => {
    const key = token ? PUBLIC_ANON_KEY : serviceKey;
    const path = method === "GET" || pathAndQuery.startsWith("rpc/") || /[?&]select=/.test(pathAndQuery)
      ? pathAndQuery
      : `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}select=*`;
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token ?? serviceKey}`, "Content-Type": "application/json", Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  };
  const storage = async (method, path, body) => {
    const res = await fetch(`${base}/storage/v1/${path}`, {
      method,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 404) throw new Error(`storage ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return { status: res.status, text };
  };
  const upload = async (bucket, path, file) => {
    const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: readFileSync(file),
    });
    if (!res.ok) throw new Error(`upload ${bucket}/${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
  return { call, storage, upload };
}

const ids = {
  job: (k) => labId(`job:${k}`),
  item: (k) => labId(`item:${k}`),
  order: (k) => labId(`order:${k}`),
  orderItem: (k) => labId(`item:${k}`),
  line: (k) => labId(`line:${k}`),
  msg: (k, i) => labId(`msg:${k}:${i}`),
  refund: (k) => labId(`refund:${k}`),
  rr: (k) => labId(`rr:${k}`),
  problem: (k) => labId(`problem:${k}`),
  payout: (k) => labId(`payout:${k}`),
};
export const allJobIds = () => JOBS.map((j) => ids.job(j.key));
export const allItemIds = () => [...ITEMS.map((i) => ids.item(i.key)), ...ORDERS.map((o) => ids.orderItem(o.key))];
export const allOrderIds = () => ORDERS.map((o) => ids.order(o.key));

/** The child tables teardown clears, by the parent column, before the parents. Order matters (FKs). */
const ORDER_CHILDREN = [
  "declutter_order_talk_messages:talk_id@declutter_order_talks",
  "declutter_order_talks:order_id", "declutter_refund_requests:order_id", "declutter_problems:order_id",
  "declutter_refunds:order_id", "declutter_payouts:order_id", "declutter_handovers:order_id", "declutter_bookings:order_id",
  "declutter_seller_deliveries:order_id", "declutter_order_deliveries:order_id", "declutter_order_porch_places:order_id",
  "declutter_order_meetups:order_id", "declutter_reviews:order_id", "declutter_funnel_events:order_id",
];
const ITEM_CHILDREN = [
  "declutter_offer_events:offer_id@declutter_offers", "declutter_swap_offers:item_id", "declutter_swap_offers:offered_item_id",
  "declutter_cart_items:item_id", "declutter_offers:item_id", "declutter_free_requests:item_id", "declutter_item_photos:item_id",
  "declutter_item_private:item_id", "declutter_tax_attestations:item_id", "declutter_watchlist:item_id", "declutter_item_views:item_id",
  "declutter_questions:item_id", "declutter_item_price_drops:item_id", "declutter_wanted_matches:item_id", "declutter_funnel_events:item_id",
  "declutter_strikes:item_id",
];
const JOB_CHILDREN = [
  "job_continue_events:job_id", "job_continue_days:job_id", "job_revisions:job_id", "disputes:job_id", "job_tracking:job_id",
  "messages:job_id", "applications:job_id", "notifications:job_id", "reviews:job_id",
];

export async function runLab({ mode, dryRun = false, rebuild = [], serviceKey, supabaseUrl = DEFAULT_SUPABASE_URL, log = console.log, now = Date.now() }) {
  if (!serviceKey) throw new Error("no service-role key (run with node --env-file=.env)");
  const { call, storage, upload } = client({ supabaseUrl, serviceKey });
  const inList = (arr) => `in.(${arr.join(",")})`;

  // Both accounts: is_seed and enrolled, by pinned id + email. Checked in every mode.
  const profs = await call("GET", `profiles?select=user_id,email,is_seed&user_id=${inList([P.userId, H.userId])}`);
  const enrolled = new Set((await call("GET", `test_accounts?select=user_id&user_id=${inList([P.userId, H.userId])}`)).map((r) => r.user_id));
  for (const a of [P, H]) {
    const p = profs.find((x) => x.user_id === a.userId);
    if (!p || p.email !== a.email || p.is_seed !== true || !enrolled.has(a.userId)) throw new Error(`REFUSED: ${a.email} is not the pinned, is_seed, enrolled test account`);
  }

  const tokens = {};
  const tok = async (a) => (tokens[a.userId] ??= (await mintAdminSession({ email: a.email, serviceKey, supabaseUrl })).access_token);
  const rpc = (name, args, token) => call("POST", `rpc/${name}`, args, token ? { token } : {});
  const results = [];
  const runStart = process.env.LAB_SINCE || new Date(Date.now() - 5_000).toISOString();
  const record = (r) => { results.push(r); log(`${r.ok ? "ok " : "NOT SEEDED"} ${r.kind} ${r.key}: ${r.state ?? ""}${r.why ? ` (${r.why})` : ""}`); };

  // ── teardown ────────────────────────────────────────────────────────────
  if (mode === "--teardown") {
    const jobIds = allJobIds();
    const itemIds = allItemIds();
    const orderIds = allOrderIds();
    const plan = [];
    const childRows = async (spec, parentIds) => {
      const [left, via] = spec.split("@");
      const [table, col] = left.split(":");
      let keys = parentIds;
      if (via) {
        const parentCol = via === "declutter_order_talks" ? "order_id" : "item_id";
        keys = (await call("GET", `${via}?select=id&${parentCol}=${inList(parentIds)}`)).map((r) => r.id);
        if (!keys.length) return { table, col, n: 0, keys };
      }
      const rows = await call("GET", `${table}?select=${col}&${col}=${inList(keys)}`).catch((e) => ({ err: e.message }));
      return { table, col, n: Array.isArray(rows) ? rows.length : 0, keys, err: rows?.err };
    };
    // Notices that point at lab rows (declutter_ref = an offer/order/item/swap id, or job_id).
    const offerIds = (await call("GET", `declutter_offers?select=id&item_id=${inList(itemIds)}`)).map((r) => r.id);
    const swapIds = (await call("GET", `declutter_swap_offers?select=id&or=(item_id.${inList(itemIds)},offered_item_id.${inList(itemIds)})`)).map((r) => r.id);
    const freeIds = (await call("GET", `declutter_free_requests?select=id&item_id=${inList(itemIds)}`)).map((r) => r.id);
    // Every notice to P or H that names a lab row: by declutter_ref (offers, swaps, free asks, cart lines, orders,
    // items), by a lab id inside its link, or listed in the manifest --apply wrote (notices built during the run).
    const lineIds = (await call("GET", `declutter_cart_items?select=id&item_id=${inList(itemIds)}`)).map((r) => r.id);
    const refs = [...itemIds, ...orderIds, ...offerIds, ...swapIds, ...freeIds, ...lineIds];
    const both = `user_id=${inList([P.userId, H.userId])}`;
    const byRef = await call("GET", `notifications?select=id&${both}&declutter_ref=${inList(refs)}`);
    const byLink = await call("GET", `notifications?select=id&${both}&or=(${[...itemIds, ...orderIds].map((id) => `link.like.*${id}*`).join(",")})`);
    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")).notifications ?? [] : [];
    const noticeIds = [...new Set([...byRef, ...byLink].map((r) => r.id).concat(manifest))];
    const stillThere = noticeIds.length ? (await call("GET", `notifications?select=id&${both}&id=${inList(noticeIds)}`)).map((r) => r.id) : [];
    plan.push({ table: "notifications", col: "id", n: stillThere.length, keys: stillThere, filter: `${both}&` });
    for (const spec of ORDER_CHILDREN) plan.push(await childRows(spec, orderIds));
    plan.push({ table: "declutter_cart_items", col: "order_id", ...(await childRows("declutter_cart_items:order_id", orderIds)) });
    plan.push({ table: "declutter_orders", col: "id", n: (await call("GET", `declutter_orders?select=id&id=${inList(orderIds)}&is_seed=is.true`)).length, keys: orderIds, filter: "is_seed=is.true&" });
    for (const spec of ITEM_CHILDREN) plan.push(await childRows(spec, itemIds));
    plan.push({ table: "declutter_items", col: "id", n: (await call("GET", `declutter_items?select=id&id=${inList(itemIds)}&is_seed=is.true`)).length, keys: itemIds, filter: "is_seed=is.true&" });
    for (const spec of JOB_CHILDREN) plan.push(await childRows(spec, jobIds));
    plan.push({ table: "jobs", col: "id", n: (await call("GET", `jobs?select=id&id=${inList(jobIds)}&is_seed=is.true`)).length, keys: jobIds, filter: "is_seed=is.true&" });
    // Storage objects the lab copied.
    const photoPaths = [];
    const photoRows = await call("GET", `declutter_item_photos?select=storage_path&item_id=${inList(itemIds)}`);
    for (const r of photoRows) photoPaths.push(r.storage_path);
    const handoverRows = await call("GET", `declutter_handovers?select=set_out_photo_path,picked_up_photo_path&order_id=${inList(orderIds)}`);
    const handoverPaths = handoverRows.flatMap((r) => [r.set_out_photo_path, r.picked_up_photo_path]).filter(Boolean);

    let total = 0;
    for (const s of plan) {
      if (s.err) log(`  ${s.table}.${s.col}: (not readable: ${s.err.slice(0, 120)})`);
      else if (s.n) log(`  ${dryRun ? "would delete" : "delete"} ${String(s.n).padStart(3)} row(s) from ${s.table} (by ${s.col})`);
      total += s.n || 0;
    }
    log(`  ${dryRun ? "would remove" : "remove"} ${photoPaths.length} listing photo(s) from ${PHOTO_BUCKET}, ${handoverPaths.length} handover photo(s) from ${HANDOVER_BUCKET}`);
    log(`${dryRun ? "DRY RUN: " : ""}${total} row(s) in ${plan.filter((s) => s.n).length} table(s)`);
    if (dryRun) return { results, plan, total };
    for (const s of plan) {
      if (!s.n || s.err) continue;
      for (let i = 0; i < s.keys.length; i += 50) {
        const chunk = s.keys.slice(i, i + 50);
        await call("DELETE", `${s.table}?${s.filter ?? ""}${s.col}=${inList(chunk)}&select=${s.col}`, undefined, { prefer: "return=minimal" });
      }
    }
    if (photoPaths.length) await storage("DELETE", `object/${PHOTO_BUCKET}`, { prefixes: photoPaths });
    if (handoverPaths.length) await storage("DELETE", `object/${HANDOVER_BUCKET}`, { prefixes: handoverPaths });
    // Read back: nothing left.
    const left = [
      ...(await call("GET", `jobs?select=id&id=${inList(jobIds)}`)),
      ...(await call("GET", `declutter_items?select=id&id=${inList(itemIds)}`)),
      ...(await call("GET", `declutter_orders?select=id&id=${inList(orderIds)}`)),
    ];
    if (left.length) throw new Error(`teardown left ${left.length} parent row(s): ${left.map((r) => r.id).join(", ")}`);
    log(`teardown: removed ${total} row(s); 0 lab jobs, items or orders remain`);
    return { results, plan, total };
  }

  // ── verify ──────────────────────────────────────────────────────────────
  const readJob = async (id) => (await call("GET", `jobs?id=eq.${id}&select=id,title,status,payment_status,helper_id,customer_id,is_seed,stripe_payment_intent_id,stripe_session_id,date_needed,start_time,helper_dayof_confirmed_at,helper_on_the_way_at,helper_arrived_at,poster_confirmed_working_at,helper_completed_at,cancellation_fee,late_cancellation`))[0] ?? null;

  if (mode === "--verify") {
    for (const j of JOBS) {
      const row = await readJob(ids.job(j.key));
      record({ kind: "job", key: j.key, id: ids.job(j.key), ok: !!row, state: row ? `${row.status}/${row.payment_status}` : "missing", label: j.label, safe: j.safe, poster: j.poster.key, helper: j.helper?.key ?? null, title: j.title, url: `${WWW}/jobs/${ids.job(j.key)}` });
    }
    for (const it of ITEMS) {
      const [row] = await call("GET", `declutter_items?id=eq.${ids.item(it.key)}&select=id,status,is_seed`);
      record({ kind: "item", key: it.key, id: ids.item(it.key), ok: !!row, state: row?.status ?? "missing", label: it.label, safe: it.safe, seller: (it.seller ?? P).key, title: it.title, url: `${WWW}/declutter/item/${ids.item(it.key)}` });
    }
    for (const o of ORDERS) {
      const [row] = await call("GET", `declutter_orders?id=eq.${ids.order(o.key)}&select=id,status,handover,is_seed`);
      record({ kind: "order", key: o.key, id: ids.order(o.key), ok: !!row, state: row ? `${row.status}/${row.handover}` : "missing", label: o.label, title: o.title, buyerUrl: `${WWW}/declutter?tab=buying&order=${ids.order(o.key)}`, sellerUrl: `${WWW}/declutter?tab=selling&order=${ids.order(o.key)}` });
    }
    const offers = await call("GET", `declutter_offers?select=id,item_id,status,awaiting,amount_cents&item_id=${inList(allItemIds())}`);
    for (const o of offers) record({ kind: "offer", key: ITEMS.find((i) => ids.item(i.key) === o.item_id)?.key ?? o.item_id, id: o.id, ok: true, state: `${o.status}${o.status === "open" ? ` (awaiting ${o.awaiting})` : ""} $${(o.amount_cents / 100).toFixed(2)}` });
    const swaps = await call("GET", `declutter_swap_offers?select=id,item_id,offered_item_id,status&item_id=${inList(allItemIds())}`);
    for (const s of swaps) record({ kind: "trade", key: ITEMS.find((i) => ids.item(i.key) === s.item_id)?.key ?? s.item_id, id: s.id, ok: true, state: s.status });
    const notes = await call("GET", `notifications?select=user_id,type,title,read&user_id=${inList([P.userId, H.userId])}&or=(job_id.${inList(allJobIds())},declutter_ref.${inList([...allItemIds(), ...allOrderIds(), ...offers.map((o) => o.id), ...swaps.map((s) => s.id)])})`);
    record({ kind: "notifications", key: "P", ok: true, state: `${notes.filter((n) => n.user_id === P.userId).length} notice(s), ${notes.filter((n) => n.user_id === P.userId && !n.read).length} unread`, types: [...new Set(notes.filter((n) => n.user_id === P.userId).map((n) => n.title))] });
    record({ kind: "notifications", key: "H", ok: true, state: `${notes.filter((n) => n.user_id === H.userId).length} notice(s), ${notes.filter((n) => n.user_id === H.userId && !n.read).length} unread`, types: [...new Set(notes.filter((n) => n.user_id === H.userId).map((n) => n.title))] });
    return { results };
  }

  // ── apply: jobs ─────────────────────────────────────────────────────────
  const jobRow = (j) => {
    const base = {
      id: ids.job(j.key), customer_id: j.poster.userId, title: j.title,
      description: `SEED TEST lab job (${j.key}) for the follow-up audit. Not a real job: funded in the database only, no Stripe payment. Built by scripts/test-lab/seed-test-lab.mjs.`,
      category: j.category, budget: j.budget, estimated_hours: 2, status: "open", payment_status: "unpaid", pricing_mode: "set_price",
      is_seed: true, helpers_needed: 1, is_group_job: false, require_photo_proof: false,
      location: ADDRESS, latitude: POINT.lat, longitude: POINT.lng,
      created_at: new Date(now - DAY).toISOString(),
    };
    if (j.to === "open" || j.to === "applied") return { ...base, date_needed: centralDate(now + 6 * DAY), start_time: "10:00:00", expires_at: new Date(now + 6 * DAY).toISOString() };
    if (j.to === "hired") return { ...base, date_needed: centralDate(now + 4 * DAY), start_time: "10:00:00" };
    if (j.to === "confirmed" || j.to === "cancelled_late") return { ...base, date_needed: centralDate(now + DAY), start_time: "11:00:00" };
    if (j.to === "cancelled_early") return { ...base, date_needed: centralDate(now + 5 * DAY), start_time: "10:00:00" };
    if (j.to === "expired") return { ...base, date_needed: centralDate(now - 2 * DAY), start_time: "10:00:00", created_at: new Date(now - 9 * DAY).toISOString() };
    return { ...base, ...laterToday(now, 3) };
  };
  const patchJob = async (id, patch, token) => {
    const rows = await call("PATCH", `jobs?id=eq.${id}&select=id`, patch, token ? { token } : {});
    if (rows?.length !== 1) throw new Error(`PATCH jobs ${id} ${Object.keys(patch).join(",")} matched ${rows?.length ?? 0}`);
  };
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  const jobMsgs = (j) => [
    [j.poster, j.helper, `Hi! Thanks for taking "${j.title.replace("SEED TEST ", "")}". The side gate is unlocked.`],
    [j.helper, j.poster, "Sounds good, see you then. I'll bring my own tools."],
    [j.poster, j.helper, "Great. Text here if anything comes up."],
  ];

  for (const j of JOBS) {
    const id = ids.job(j.key);
    try {
      const existing = await readJob(id);
      if (existing) { record({ kind: "job", key: j.key, id, ok: true, state: `kept ${existing.status}/${existing.payment_status}` }); continue; }
      const [ins] = await call("POST", "jobs?select=id", jobRow(j));
      if (ins?.id !== id) throw new Error("insert returned no row");
      // Funded in the database only (an UPDATE, which the open-job cap does not judge).
      await patchJob(id, { payment_status: "escrow" });
      if (j.to === "open") { record({ kind: "job", key: j.key, id, ok: true, state: "open/escrow" }); continue; }
      if (j.to === "expired") {
        // How auto-expire-jobs closes a listing nobody took (src/lib/expiredListing.ts).
        await patchJob(id, { status: "cancelled", payment_status: "refunded", cancelled_at: ago(60 * 24), cancellation_reason: "Job listing expired with no Helpr hired", expires_at: ago(60 * 24) });
        record({ kind: "job", key: j.key, id, ok: true, state: "cancelled/refunded (expired)" });
        continue;
      }
      const helperTok = await tok(j.helper);
      const posterTok = await tok(j.poster);
      const appId = await rpc("apply_to_job", { p_job_id: id, p_message: "Hi, I can do this. I have done this kind of job many times and can bring my own tools." }, helperTok);
      if (j.to === "applied") { record({ kind: "job", key: j.key, id, ok: true, state: "open/escrow, 1 applicant" }); continue; }
      await rpc("accept_application", { p_application_id: appId, p_deadline: new Date(now + 48 * HOUR).toISOString(), p_offer_message: null }, posterTok);
      const accepted = await rpc("complete_job_accept", { p_job_id: id });
      if (accepted !== true) throw new Error(`complete_job_accept answered ${JSON.stringify(accepted)}`);
      // The chat, both sides (service role with v5 ids, as seedStateFixtures does: a sender may not pick an id).
      for (const [i, [from, to, content]] of jobMsgs(j).entries()) {
        await call("POST", "messages?select=id", { id: ids.msg(j.key, i), job_id: id, sender_id: from.userId, receiver_id: to.userId, content, created_at: ago(120 - i * 10) });
      }
      if (j.to === "hired") { record({ kind: "job", key: j.key, id, ok: true, state: "accepted (hired)" }); continue; }
      if (j.to === "cancelled_early" || j.to === "cancelled_late") {
        // The terminal write only (no refund call: there is no payment to refund).
        const late = j.to === "cancelled_late";
        await patchJob(id, {
          status: "cancelled", payment_status: "refunded", cancelled_by: j.poster.userId, cancelled_at: ago(20),
          cancellation_reason: late ? "Plans changed, sorry for the short notice." : "Found someone in the family to do it.",
          late_cancellation: late, ...(late ? { cancellation_fee: Math.round(j.budget * 0.25) } : {}),
        });
        await call("PATCH", `applications?job_id=eq.${id}&select=id`, { status: "rejected", closed_reason: "job_cancelled" }).catch((e) => log(`  ${j.key}: application close skipped: ${e.message.slice(0, 140)}`));
        record({ kind: "job", key: j.key, id, ok: true, state: `cancelled/refunded (${late ? "late" : "early"})` });
        continue;
      }
      // Both day-of confirms, as the two parties' own writes (src/components/JobConfirmation.tsx).
      await patchJob(id, { helper_dayof_confirmed_at: ago(60) }, helperTok);
      if (j.to !== "confirmed") await patchJob(id, { poster_confirmed_at: ago(50) }, posterTok);
      if (j.to === "confirmed") { record({ kind: "job", key: j.key, id, ok: true, state: "accepted, Helpr confirmed" }); continue; }
      await rpc("helper_mark_on_the_way", { p_job_id: id, p_lat: POINT.lat, p_lng: POINT.lng }, helperTok);
      if (j.to === "on_the_way") { record({ kind: "job", key: j.key, id, ok: true, state: "on the way" }); continue; }
      const verdict = await rpc("mark_helper_arrival", { p_job_id: id, p_lat: POINT.lat, p_lng: POINT.lng }, helperTok);
      if (!verdict?.verified) throw new Error(`arrival not verified: ${JSON.stringify(verdict)}`);
      if (j.to === "arrived") { record({ kind: "job", key: j.key, id, ok: true, state: "in_progress, arrived" }); continue; }
      // Poster confirms arrival and work started (useLifecycleHandlers / posterArrival.ts writes).
      await patchJob(id, { poster_confirmed_arrival_at: new Date().toISOString() }, posterTok);
      await patchJob(id, { poster_confirmed_working_at: new Date().toISOString() }, posterTok);
      try {
        const tr = await call("GET", `job_tracking?job_id=eq.${id}&select=id`, undefined, { token: helperTok });
        if (tr[0]) await call("PATCH", `job_tracking?id=eq.${tr[0].id}&select=id`, { status: "working", updated_at: new Date().toISOString() }, { token: helperTok });
      } catch (e) { log(`  ${j.key}: tracker row 'working' skipped: ${e.message.slice(0, 160)}`); }
      if (j.to === "working") { record({ kind: "job", key: j.key, id, ok: true, state: "in_progress, working" }); continue; }
      if (j.to === "continue_day") {
        const cid = await rpc("propose_job_continue_day", { p_job_id: id, p_date: centralDate(now + 2 * DAY), p_start_time: "09:00", p_note: "Ran out of daylight; the back row of pavers is left." }, helperTok);
        const contId = typeof cid === "string" ? cid : cid?.id ?? cid?.continue_id;
        if (!contId) throw new Error(`propose_job_continue_day returned ${JSON.stringify(cid)}`);
        await rpc("answer_job_continue_day", { p_continue_id: contId, p_accept: true }, posterTok);
        record({ kind: "job", key: j.key, id, ok: true, state: "in_progress, another day agreed" });
        continue;
      }
      // The Helpr marks it done (rpc_helper_mark_done). The 30-minute Done floor counts from
      // poster_confirmed_working_at, so that stamp is moved back first (service role, the one non-door write).
      await patchJob(id, { poster_confirmed_working_at: ago(90), poster_confirmed_arrival_at: ago(95) });
      await rpc("rpc_helper_mark_done", { _job_id: id }, helperTok);
      if (j.to === "done") { record({ kind: "job", key: j.key, id, ok: true, state: "done, awaiting approval" }); continue; }
      if (j.to === "revision") {
        await call("POST", "job_revisions?select=id", { job_id: id, requested_by: j.poster.userId, description: "The far corner of the deck still has mildew, and the steps were skipped.", photos: [], status: "pending" }, { token: posterTok });
        await patchJob(id, { status: "revision_requested", revision_note: "The far corner of the deck still has mildew, and the steps were skipped.", revision_requested_at: new Date().toISOString(), revision_count: 1 }, posterTok);
        record({ kind: "job", key: j.key, id, ok: true, state: "revision_requested" });
        continue;
      }
      if (j.to === "approved") {
        // release-payout's terminal write, without the release (as seedStateFixtures helper-completed).
        const at = new Date().toISOString();
        const done = await call("PATCH", `jobs?id=eq.${id}&payment_status=eq.escrow&stripe_payment_intent_id=is.null&stripe_session_id=is.null&select=id`, { status: "completed", payment_status: "released", poster_completed_at: at, completed_at: at });
        if (done?.length !== 1) throw new Error(`completing matched ${done?.length ?? 0}`);
        record({ kind: "job", key: j.key, id, ok: true, state: "completed/released" });
        continue;
      }
      if (j.to === "disputed") {
        await rpc("rpc_open_dispute", { _job_id: id, _reason: "Two corners of the grout are already cracking and one tile was left loose.", _evidence_urls: [] }, posterTok);
        record({ kind: "job", key: j.key, id, ok: true, state: "disputed" });
        continue;
      }
    } catch (e) {
      const row = await readJob(id).catch(() => null);
      record({ kind: "job", key: j.key, id, ok: false, state: row ? `left at ${row.status}/${row.payment_status}` : "missing", why: e.message.slice(0, 300) });
    }
  }

  // ── apply: Declutter listings ───────────────────────────────────────────
  const itemRow = (id, it, status) => ({
    id, seller_id: (it.seller ?? P).userId, sale_mode: "offers", status, title: it.title,
    description: `SEED TEST lab listing for the follow-up audit. Not for sale to real members (hidden from everyone but test accounts). Gently used, works well.`,
    category: "home", condition_stars: 4, delivery_size: "small", price_cents: it.price, current_price_cents: it.price,
    area_label: "Lafayette", area_lat: POINT.lat, area_lng: POINT.lng, is_seed: true, accepts_offers: it.price > 0, accepts_trades: !!it.trades,
    porch_ok: true, handovers: ["porch", "pickup_home"], submitted_at: ago(60 * 26), live_at: ago(60 * 25), admin_approved_at: ago(60 * 25),
    created_at: ago(60 * 26), listed_until: new Date(now + 30 * DAY).toISOString(),
  });
  const photoFor = (key) => {
    const f = join(PHOTO_DIR, `${key}.jpg`);
    if (!existsSync(f)) throw new Error(`no photo ${f}: run node scripts/test-lab/render-lab-photos.mjs ${PHOTO_DIR}`);
    return f;
  };
  const ensureItem = async (id, it, status) => {
    const seller = (it.seller ?? P).userId;
    const [have] = await call("GET", `declutter_items?id=eq.${id}&select=id,status`);
    if (!have) {
      const [row] = await call("POST", "declutter_items?select=id", itemRow(id, it, status));
      if (row?.id !== id) throw new Error("item insert returned no row");
    }
    // Repairs on every run: the private row and the photo.
    const [priv] = await call("GET", `declutter_item_private?item_id=eq.${id}&select=item_id`);
    if (!priv) await call("POST", "declutter_item_private?select=item_id", { item_id: id, seller_id: seller, pickup_address: ADDRESS, pickup_lat: POINT.lat, pickup_lng: POINT.lng, floor_price_cents: it.price ? Math.round(it.price * 0.6) : 0 });
    const photos = await call("GET", `declutter_item_photos?item_id=eq.${id}&select=id`);
    if (!photos.length) {
      const dest = `${seller}/declutter/${id}/lab0.jpg`;
      await upload(PHOTO_BUCKET, dest, photoFor(it.key));
      await call("POST", "declutter_item_photos?select=id", { item_id: id, seller_id: seller, storage_path: dest, position: 0 });
    }
    return !have;
  };
  for (const it of ITEMS) {
    const id = ids.item(it.key);
    try {
      const made = await ensureItem(id, it, it.status);
      record({ kind: "item", key: it.key, id, ok: true, state: `${made ? "built" : "kept"} ${it.status}` });
    } catch (e) {
      record({ kind: "item", key: it.key, id, ok: false, why: e.message.slice(0, 300) });
    }
  }

  // ── apply: offers (buyer H, seller P, through declutter_make_offer / declutter_respond_offer) ──
  const hTok = await tok(H);
  const pTok = await tok(P);
  const offerOn = async (key) => (await call("GET", `declutter_offers?select=id,status&item_id=eq.${ids.item(key)}&buyer_id=eq.${H.userId}&order=created_at.desc`))[0] ?? null;
  const offerPlan = [
    ["offer-open", 1500, null],
    ["offer-countered", 1200, "counter"],
    ["offer-accepted", 2000, "accept"],
    ["offer-declined", 700, "decline"],
    ["offer-expired", 1100, "expire"],
  ];
  for (const [key, amount, then] of offerPlan) {
    try {
      let o = await offerOn(key);
      if (!o) {
        const oid = await rpc("declutter_make_offer", { p_item_id: ids.item(key), p_amount_cents: amount }, hTok);
        o = { id: oid };
        if (then === "counter") await rpc("declutter_respond_offer", { p_offer_id: oid, p_action: "counter", p_amount_cents: 1500 }, pTok);
        if (then === "accept") {
          await rpc("declutter_respond_offer", { p_offer_id: oid, p_action: "accept", p_amount_cents: null }, pTok);
          // Keep the cart line from lapsing into a missed-checkout strike before teardown.
          await call("PATCH", `declutter_cart_items?offer_id=eq.${oid}&status=eq.in_cart&select=id`, { checkout_by: new Date(now + 6 * DAY).toISOString() });
        }
        if (then === "decline") await rpc("declutter_respond_offer", { p_offer_id: oid, p_action: "decline", p_amount_cents: null }, pTok);
        if (then === "expire") {
          // What expire_unanswered_offers writes when respond_by passes, without waiting 48 hours.
          await call("PATCH", `declutter_offers?id=eq.${oid}&status=eq.open&select=id`, { status: "expired", closed_at: new Date().toISOString(), respond_by: ago(5) });
          await call("POST", "declutter_offer_events?select=id", { offer_id: oid, actor_side: "seller", action: "expire", amount_cents: amount }).catch(() => {});
        }
      } else {
        // An open offer must not expire on its own before teardown (48 h respond_by).
        if (o.status === "open") await call("PATCH", `declutter_offers?id=eq.${o.id}&status=eq.open&select=id`, { respond_by: new Date(now + 6 * DAY).toISOString() });
      }
      const [row] = await call("GET", `declutter_offers?select=id,status,awaiting,amount_cents&id=eq.${o.id}`);
      if (row?.status === "open") await call("PATCH", `declutter_offers?id=eq.${o.id}&status=eq.open&select=id`, { respond_by: new Date(now + 6 * DAY).toISOString() });
      record({ kind: "offer", key, id: o.id, ok: !!row, state: row ? `${row.status}${row.status === "open" ? ` (awaiting ${row.awaiting})` : ""}` : "missing" });
    } catch (e) {
      record({ kind: "offer", key, ok: false, why: e.message.slice(0, 300) });
    }
  }

  // ── apply: trades (H offers its item for P's, declutter_offer_swap / declutter_respond_swap) ──
  const tradePlan = [["trade-want", "trade-give-1", null], ["trade-accepted-want", "trade-give-2", "accept"], ["trade-lapsed-want", "trade-give-3", "lapse"]];
  for (const [want, give, then] of tradePlan) {
    try {
      let [s] = await call("GET", `declutter_swap_offers?select=id,status&item_id=eq.${ids.item(want)}&offered_item_id=eq.${ids.item(give)}`);
      if (!s) {
        const sid = await rpc("declutter_offer_swap", { p_item_id: ids.item(want), p_offered_item_id: ids.item(give) }, hTok);
        s = { id: typeof sid === "string" ? sid : sid?.id };
        if (then === "accept") {
          await rpc("declutter_respond_swap", { p_swap_id: s.id, p_action: "accept" }, pTok);
          await call("PATCH", `declutter_cart_items?item_id=${inList([ids.item(want), ids.item(give)])}&status=eq.in_cart&select=id`, { checkout_by: new Date(now + 6 * DAY).toISOString() });
        }
        if (then === "lapse") {
          // What declutter_swap_sweep writes when the answer window passes.
          await call("PATCH", `declutter_swap_offers?id=eq.${s.id}&status=eq.open&select=id`, { status: "lapsed", closed_at: new Date().toISOString(), respond_by: ago(5) });
        }
      }
      const [row] = await call("GET", `declutter_swap_offers?select=id,status&id=eq.${s.id}`);
      if (row?.status === "open") await call("PATCH", `declutter_swap_offers?id=eq.${s.id}&status=eq.open&select=id`, { respond_by: new Date(now + 6 * DAY).toISOString() });
      record({ kind: "trade", key: want, id: s.id, ok: !!row, state: row?.status ?? "missing" });
    } catch (e) {
      record({ kind: "trade", key: want, ok: false, why: e.message.slice(0, 300) });
    }
  }

  // ── apply: orders (buyer H, seller P). Inserted: a paid order has no door without a real payment. ──
  const premium = (items, delivery = 0) => Math.round((items + delivery) * 0.05) + 70;
  for (const o of ORDERS) {
    const oid = ids.order(o.key);
    const itemId = ids.orderItem(o.key);
    try {
      const [have] = await call("GET", `declutter_orders?id=eq.${oid}&select=id,status`);
      if (have && rebuild.includes(o.key)) {
        // Drop the half-built order and its children (lab ids only), then build it again.
        const talks = (await call("GET", `declutter_order_talks?select=id&order_id=eq.${oid}`)).map((r) => r.id);
        if (talks.length) await call("DELETE", `declutter_order_talk_messages?talk_id=${inList(talks)}&select=id`, undefined, { prefer: "return=minimal" });
        for (const spec of ORDER_CHILDREN.slice(1)) {
          const [table, col] = spec.split(":");
          await call("DELETE", `${table}?${col}=eq.${oid}&select=${col}`, undefined, { prefer: "return=minimal" }).catch(() => {});
        }
        await call("DELETE", `notifications?declutter_ref=eq.${oid}&select=id`, undefined, { prefer: "return=minimal" });
        await call("DELETE", `declutter_cart_items?order_id=eq.${oid}&select=id`, undefined, { prefer: "return=minimal" });
        await call("DELETE", `declutter_orders?id=eq.${oid}&is_seed=is.true&buyer_id=eq.${H.userId}&select=id`, undefined, { prefer: "return=minimal" });
        log(`  ${o.key}: rebuilding`);
      } else if (have) { record({ kind: "order", key: o.key, id: oid, ok: true, state: `kept ${have.status}` }); continue; }
      const handedOver = ["o-picked-up", "o-completed", "o-refund-requested", "o-refund-partial", "o-refund-declined"].includes(o.key);
      const refunded = o.key === "o-buyer-cancelled";
      const doneAt = o.key === "o-picked-up" ? ago(60) : ago(60 * 24 * 3);
      await ensureItem(itemId, { ...o, seller: P }, refunded ? "withdrawn" : handedOver ? "completed" : "sold");
      const delivery = o.delivery ?? 0;
      const prem = premium(o.price, delivery);
      const total = o.price + prem + delivery;
      const paidAt = handedOver ? ago(60 * 24 * 4) : ago(60 * 5);
      const order = {
        id: oid, buyer_id: H.userId, seller_id: P.userId, status: refunded ? "refunded" : handedOver ? "handed_over" : "paid",
        handover: o.handover, items_cents: o.price, premium_cents: prem, tax_cents: 0, total_cents: total, delivery_cents: delivery,
        shipping_cents: 0, setup_fee_cents: 0, bundle_discount_cents: 0, gift_cents: 0,
        fee_rule: o.handover === "seller_delivery" ? "f1_seller_delivery" : "f1", paid_with: "card", card_fee_cents: Math.round(total * 0.029) + 30,
        is_seed: true, created_at: paidAt, paid_at: paidAt, stripe_paid_at: paidAt,
        ...(handedOver ? { handed_over_at: doneAt, closed_at: doneAt, close_reason: "handed_over" } : {}),
        ...(refunded ? { closed_at: ago(30), close_reason: "refunded" } : {}),
      };
      const [ins] = await call("POST", "declutter_orders?select=id", order);
      if (ins?.id !== oid) throw new Error("order insert returned no row");
      await call("POST", "declutter_cart_items?select=id", { id: ids.line(o.key), item_id: itemId, buyer_id: H.userId, seller_id: P.userId, price_cents: o.price, source: "buy", order_id: oid, status: "paid", checkout_by: new Date(Date.parse(paidAt) + 2 * DAY).toISOString(), closed_at: paidAt, item_title: o.title, is_seed: true, created_at: paidAt });
      // Never leave a payout the money cron would send (declutter_payouts_due does not skip seed).
      const strayPayouts = await call("GET", `declutter_payouts?select=id,status&order_id=eq.${oid}`);
      for (const p of strayPayouts) if (p.status === "pending" || p.status === "failed") throw new Error(`a ${p.status} payout row appeared for the order (${p.id}); stopping`);

      const slot = (daysOut, h = 17) => {
        const d = centralDate(now + daysOut * DAY);
        const start = new Date(`${d}T${String(h).padStart(2, "0")}:00:00-06:00`).toISOString();
        return { slot_start: start, slot_end: new Date(Date.parse(start) + 30 * 60_000).toISOString() };
      };
      const booking = (s) => call("POST", "declutter_bookings?select=order_id", { order_id: oid, buyer_id: H.userId, seller_id: P.userId, ...s, is_seed: true });
      if (o.key === "o-booked" || o.key === "o-problem") await booking(slot(2));
      if (o.key === "o-porch-photo") {
        await booking(slot(2));
        const dest = `${P.userId}/declutter/handover/${oid}/set-out.jpg`; // <uid>/declutter/handover/<order>/<file> (declutter_handover_photo_access)
        await upload(HANDOVER_BUCKET, dest, photoFor("set-out"));
        await call("POST", "declutter_handovers?select=order_id", { order_id: oid, code: "4821", set_out_photo_path: dest, set_out_at: ago(15), set_out_note: "On the porch bench, left side.", seller_confirmed_at: ago(15) });
      }
      if (handedOver) {
        const at = doneAt;
        await call("POST", "declutter_bookings?select=order_id", { order_id: oid, buyer_id: H.userId, seller_id: P.userId, slot_start: new Date(Date.parse(at) - 30 * 60_000).toISOString(), slot_end: at, is_seed: true })
          .catch((e) => log(`  ${o.key}: past booking skipped: ${e.message.slice(0, 160)}`));
        let pickedUp = {};
        if (o.handover === "porch") {
          const dest = `${H.userId}/declutter/handover/${oid}/picked-up.jpg`;
          await upload(HANDOVER_BUCKET, dest, photoFor(o.key));
          pickedUp = { picked_up_at: at, picked_up_photo_path: dest };
        }
        await call("POST", "declutter_handovers?select=order_id", { order_id: oid, code: "5310", confirmed_at: at, confirmed_by: "buyer", ...pickedUp });
      }
      if (o.key === "o-completed") {
        await call("POST", "declutter_payouts?select=id", { id: ids.payout(o.key), order_id: oid, seller_id: P.userId, items_cents: o.price, debt_cents: 0, amount_cents: o.price, status: "settled_by_hand", settled_by_hand_ref: "TEST-LAB-NO-STRIPE", settled_by_hand_cents: o.price, settled_by_hand_note: "SEED TEST lab row: no money moved (scripts/test-lab/seed-test-lab.mjs).", attempts: 0, next_attempt_at: doneAt, executed_at: ago(60 * 24 * 2), refunded_cents: 0, delivery_cents: 0, setup_fee_cents: 0, manager_share_cents: 0, is_seed: true });
      }
      if (o.key === "o-delivery") {
        const s = slot(2, 18);
        const [sd] = await call("GET", `declutter_seller_deliveries?select=order_id,status&order_id=eq.${oid}`);
        const values = { status: "booked", ...s, dropoff_address: "305 E Vermilion St, Lafayette, LA 70501", dropoff_area: "Downtown Lafayette", dropoff_lat: 30.2241, dropoff_lng: -92.0179, handoff: "hand", is_seed: true };
        if (sd) await call("PATCH", `declutter_seller_deliveries?order_id=eq.${oid}&select=order_id`, values);
        else await call("POST", "declutter_seller_deliveries?select=order_id", { order_id: oid, buyer_id: H.userId, seller_id: P.userId, ...values });
      }
      if (refunded) {
        await call("POST", "declutter_refunds?select=id", { id: ids.refund(o.key), order_id: oid, stripe_payment_intent_id: `${LAB_PI}_${o.key.replace(/-/g, "_")}`, reason: "buyer_cancelled", fee_policy: "keep_card_fee", paid_cents: total, card_fee_cents: order.card_fee_cents, refund_cents: total - order.card_fee_cents, kept_cents: 0, status: "succeeded", executed_at: ago(25), attempts: 0, gift_refund_cents: 0 });
      }
      if (o.key === "o-refund-requested") {
        await call("POST", "declutter_refund_requests?select=id", { id: ids.rr(o.key), order_id: oid, reason: "not_as_described", note: "The basket is cracked and the lid does not close. The listing said like new.", status: "open", answer_by: new Date(now + 5 * DAY).toISOString(), photo_paths: [], created_at: ago(40) });
      }
      if (o.key === "o-refund-partial") {
        const part = 2000;
        await call("POST", "declutter_refunds?select=id", { id: ids.refund(o.key), order_id: oid, stripe_payment_intent_id: `${LAB_PI}_${o.key.replace(/-/g, "_")}`, reason: "refund_request_part", fee_policy: "agreed_part", paid_cents: total, card_fee_cents: 0, refund_cents: part, kept_cents: 0, status: "succeeded", executed_at: ago(60 * 20), attempts: 0, gift_refund_cents: 0 });
        await call("POST", "declutter_refund_requests?select=id", { id: ids.rr(o.key), order_id: oid, reason: "damaged", note: "One corner has a stain that was not in the photos.", status: "agreed", answer_by: ago(60 * 24), offer_cents: part, offered_at: ago(60 * 30), offer_answer_by: ago(60 * 22), refund_id: ids.refund(o.key), settled_at: ago(60 * 20), photo_paths: [], created_at: ago(60 * 40) });
      }
      if (o.key === "o-refund-declined") {
        await call("POST", "declutter_refund_requests?select=id", { id: ids.rr(o.key), order_id: oid, reason: "not_as_described", note: "It is louder than I expected.", status: "declined", answer_by: new Date(now + 5 * DAY).toISOString(), declined_at: ago(60), seller_note: "It worked fine when I tested it in front of you at pickup.", photo_paths: [], created_at: ago(60 * 5) });
      }
      if (o.key === "o-problem") {
        await call("POST", "declutter_problems?select=id", { id: ids.problem(o.key), order_id: oid, reporter_id: H.userId, reporter_side: "buyer", reason: "not_as_described", note: "The seat will not stay up; the listing said it works.", photo_paths: [], status: "open", decide_by: new Date(now + 5 * DAY).toISOString() });
      }
      // The order chat, both sides, through the app's own RPC.
      try {
        await rpc("declutter_send_order_message", { p_order_id: oid, p_body: "Hi! Is the item still easy to get to from the driveway?" }, hTok);
        await rpc("declutter_send_order_message", { p_order_id: oid, p_body: "Yes, it is right by the front steps. See you then." }, pTok);
      } catch (e) { log(`  ${o.key}: order chat skipped: ${e.message.slice(0, 200)}`); }
      const [row] = await call("GET", `declutter_orders?select=status,handover&id=eq.${oid}`);
      record({ kind: "order", key: o.key, id: oid, ok: true, state: `${row.status}/${row.handover}` });
    } catch (e) {
      record({ kind: "order", key: o.key, id: oid, ok: false, why: e.message.slice(0, 300) });
    }
  }
  // Every notice P and H received while this run built rows: the lab's own (the nightly suites may add a few of
  // theirs in the same minutes; those are test-account notices too, so deleting them at teardown is harmless).
  const built = await call("GET", `notifications?select=id&user_id=${inList([P.userId, H.userId])}&created_at=gte.${runStart}`);
  const prior = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")).notifications ?? [] : [];
  writeFileSync(MANIFEST, JSON.stringify({ updated: new Date().toISOString(), notifications: [...new Set([...prior, ...built.map((r) => r.id)])] }, null, 2));
  log(`manifest: ${built.length} notice id(s) from this run recorded in ${MANIFEST}`);
  return { results };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = ["--apply", "--verify", "--teardown"].find((m) => process.argv.includes(m));
  if (!mode) {
    console.error("Usage: node --env-file=.env scripts/test-lab/seed-test-lab.mjs --apply | --verify | --teardown [--dry-run] [--json=<file>]");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const jsonArg = process.argv.find((a) => a.startsWith("--json="));
  const rebuildArg = process.argv.find((a) => a.startsWith("--rebuild="));
  runLab({ mode, dryRun, rebuild: rebuildArg ? rebuildArg.slice(10).split(",") : [], serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null })
    .then(({ results }) => {
      if (jsonArg) writeFileSync(jsonArg.slice(7), JSON.stringify(results, null, 2));
      const bad = results.filter((r) => !r.ok);
      console.log(`${mode}${dryRun ? " --dry-run" : ""}: ${results.length} row(s) reported, ${bad.length} not seeded`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`seed-test-lab ${mode} FAILED: ${e.message}`);
      process.exit(1);
    });
}
