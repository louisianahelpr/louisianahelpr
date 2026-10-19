/**
 * MOCK-ONLY (wip/dashboards-mock-1019-r2 — never lands).
 *
 * JOBS + DECLUTTER: a read-only snapshot of REAL prod rows taken 2026-10-19
 * 02:30Z with SQL (no writes). "Me" = the two test accounts combined:
 * posted jobs = helpr-e2e-poster-0902, applied/working jobs + listings =
 * helpr-e2e-helper-0902. Titles are tidied for display only (the "SEED " and
 * "[E2E ...]" tags and run ids stripped).
 *
 * SHOPS + HOMES: prod has ZERO shops / rental rows, so these are SAMPLE rows
 * in the real column shapes (shops, shop_items, shop_orders, shop_payouts,
 * rental_properties, rental_units, rental_tenancies, maintenance_requests).
 * Rent is NOT in the data model yet; the rent rows are sample-only.
 */
export type MockJob = {
  title: string;
  category: string;
  budget: number;
  date: string; // "Sat, Oct 25"
  time?: string;
  city: string;
  note?: string; // status line
};

export const unreadMessages = 4; // 3 (helper) + 1 (poster) unread in prod

/* ---------- JOBS I POSTED (poster-e2e: 345 jobs) ---------- */
export const posted = {
  counts: { needsYou: 6, upcoming: 7, inProgress: 9, done: 18, cancelled: 307 },
  needsYou: [
    { title: "Mow and edge a corner lot", category: "yard_work", budget: 95, date: "Sat, Oct 25", city: "Lafayette", note: "1 person applied — pick a helpr" },
    { title: "Feed and walk two dogs", category: "pet_care", budget: 160, date: "Sat, Oct 25", city: "Lafayette", note: "1 person applied — pick a helpr" },
    { title: "Handyman fixture job", category: "handyman", budget: 25, date: "Fri, Nov 13", city: "Baton Rouge", note: "Dispute open — add your side" },
  ] as MockJob[],
  upcoming: [
    { title: "Hang shelves and a TV mount", category: "handyman", budget: 150, date: "Sun, Oct 25", city: "Lafayette", note: "Being checked before it goes live" },
    { title: "Haul storm debris — crew", category: "storm_prep", budget: 300, date: "Sun, Oct 25", city: "Lafayette", note: "Open — no one has applied yet" },
    { title: "Deep clean a kitchen", category: "cleaning", budget: 120, date: "Wed, Nov 11", city: "Lafayette", note: "Open — no one has applied yet" },
  ] as MockJob[],
  inProgress: [
    { title: "Move a sectional (crew)", category: "moving", budget: 200, date: "Sat, Oct 17", time: "9:00 AM", city: "Lafayette", note: "Helpr is working" },
    { title: "Cleaning test job", category: "cleaning", budget: 25, date: "Mon, Oct 19", city: "Baton Rouge", note: "Waiting on the helpr to mark it done" },
  ] as MockJob[],
};

/* ---------- JOBS I APPLIED TO / I'M WORKING (helper-e2e: 49 applications) ---------- */
export const working = {
  counts: { needsYou: 4, applied: 2, upcoming: 1, inProgress: 9, done: 16, notPicked: 18 },
  needsYou: [
    { title: "Cleaning test job", category: "cleaning", budget: 25, date: "Today", city: "Baton Rouge", note: "Mark it done when you finish" },
    { title: "Handyman fixture job", category: "handyman", budget: 25, date: "Tue, Nov 10", city: "Baton Rouge", note: "Dispute open — reply by Fri" },
  ] as MockJob[],
  applied: [
    { title: "Mow and edge a corner lot", category: "yard_work", budget: 95, date: "Sun, Oct 25", city: "Lafayette", note: "Applied — waiting to hear back" },
    { title: "Feed and walk two dogs", category: "pet_care", budget: 160, date: "Sun, Oct 25", city: "Lafayette", note: "Applied — waiting to hear back" },
  ] as MockJob[],
  upcoming: [
    { title: "Handyman fixture job", category: "handyman", budget: 25, date: "Thu, Nov 12", city: "Baton Rouge", note: "You're booked" },
  ] as MockJob[],
};

/* ---------- DECLUTTER (helper-e2e's 4 listings; 0 orders/offers/wanted/deliveries in all of prod) ---------- */
export const declutter = {
  selling: [
    { title: "Rocking chair", price: 38, was: 40, area: "Downtown, Baton Rouge", status: "Live", note: "Price dropped to $38" },
    { title: "Rocking chair (2nd)", price: 38, was: 40, area: "Downtown, Baton Rouge", status: "Live", note: "Price dropped to $38" },
    { title: "Side table", price: 40, area: "Downtown, Baton Rouge", status: "In review", note: "We're checking it — usually within a day" },
    { title: "Side table (2nd)", price: 40, area: "Downtown, Baton Rouge", status: "In review", note: "We're checking it — usually within a day" },
  ],
  counts: { buying: 0, offers: 0, selling: 4, live: 2, review: 2, wanted: 0, deliver: 0 },
  nearby: [
    { title: "Rocking chair", price: 38, area: "Downtown" },
    { title: "Rocking chair", price: 38, area: "Downtown" },
  ],
};

/* ---------- SHOPS — SAMPLE (prod has 0 shops) ---------- */
export const shopSample = {
  shop: { name: "Bayou Bakes", category: "baked_goods", area_label: "Lafayette", paused: false },
  buyerOrders: [
    { shop: "Magnolia Candles", title: "Fig & cane candle ×2", total: 36, status: "Ready for pickup", when: "Pick up by Wed" },
  ],
  toFulfill: [
    { buyer: "Renee B.", title: "King cake (large)", total: 42, status: "held", note: "Accept by 6 PM today" },
    { buyer: "Marcus T.", title: "Pecan pralines ×12", total: 24, status: "held", note: "Accept by 9 AM tomorrow" },
    { buyer: "Dana L.", title: "Beignet mix ×3", total: 27, status: "accepted", note: "Make by Sat — pickup" },
  ],
  items: { live: 9, review: 1, soldOut: 2 },
  payouts: { pendingCents: 18450, nextDate: "Fri, Oct 23", monthCents: 61200 },
  nearbyShops: [
    { name: "Magnolia Candles", kind: "Candles", area: "Broussard" },
    { name: "Cajun Pepper Co.", kind: "Sauces", area: "Breaux Bridge" },
  ],
};

/* ---------- HOMES — SAMPLE (prod has 0 rental rows; rent is not in the data model yet) ---------- */
export const homesSample = {
  landlord: {
    repairs: [
      { property_label: "Oak St duplex", unit_label: "Unit B", category: "Plumbing", description: "Kitchen sink leaking under the cabinet", urgency: "urgent", status: "open", age: "2 h ago" },
      { property_label: "Elm cottage", unit_label: "", category: "Appliance", description: "Dryer not heating", urgency: "normal", status: "visit_proposed", age: "Visit Thu 10 AM" },
    ],
    properties: [
      { label: "Oak St duplex", street_address: "412 Oak St, Lafayette", units: 2, tenants: 2, rent: "1 of 2 paid", rentLate: true },
      { label: "Elm cottage", street_address: "88 Elm Ave, Youngsville", units: 1, tenants: 1, rent: "Paid", rentLate: false },
    ],
    rent: { paid: 2, due: 1, totalCents: 285000, collectedCents: 190000, dueDate: "Nov 1" },
  },
  tenant: {
    lease: { property: "Cypress Lofts", unit: "Apt 3", landlord: "Pat Guidry", rentCents: 115000, due: "Nov 1", ends: "Jul 31, 2027" },
    repairs: [{ category: "Electrical", description: "Hall light flickers", status: "Fixed? Tell us", age: "Done Mon" }],
  },
};

export const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const cents = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
