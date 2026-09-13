/**
 * HEAVY seed — the stress variant of ./seedData.
 *
 * Selected with `installSupabaseMocks(page, { seed: "heavy" })`, or for the
 * sweep with `SWEEP_SEED=heavy` and for press-every-control with `SEED=heavy`.
 *
 * The normal seed is realistic: the lengths and counts a typical account has.
 * Layout breaks on the tail, not the median — the poster with a 60-character
 * name, the job with 45 applicants, the thread nobody archived, the Helpr who
 * has earned more in a year than the column was sized for. This file is that
 * tail, in one place, so a sweep can be pointed at it on purpose.
 *
 * ADDITIVE. Every row and id in SEED_TABLES is still present, so any screen a
 * spec reaches by a normal seed id still resolves under heavy. Heavy rows use
 * their own id prefixes (1e…, 2e…, 3e…, 4e…, 5e…, 64e…, 65e…) and never reuse
 * a normal id.
 *
 * Contents (asserted by src/test/seedDataHeavy.test.ts, so this list cannot
 * drift from the data):
 *   - 45 extra counterparty profiles: very long, hyphenated, accented, CJK,
 *     Vietnamese, Arabic and emoji names; 1000-character bios.
 *   - 1 job with a 150-character title, a ~5000-character description, the
 *     maximum budget and urgent fee the DB admits (5000 / 5000), and 45
 *     applicants with long messages.
 *   - 110 extra OPEN jobs in browse (so the feed holds 110+ on its own),
 *     emoji and multibyte titles, budgets up to the 5000 ceiling.
 *   - A 220-message thread between the two test accounts, including 4000-char
 *     messages (the `char_length(content) <= 4000` ceiling), emoji-only lines
 *     and unbroken strings.
 *   - 60 completed, released jobs for the helper at 3000–5000 each, with
 *     payouts of up to $4,400 and a single $250,000 admin payout row, tips at
 *     the 1000 ceiling: earnings totals in six figures.
 *   - 60 notifications per test account; 50 long reviews for the helper.
 *
 * Constraint notes: `jobs_budget_range` caps budget at 5000 and
 * `tips_amount_positive` caps a tip at 1000, so "very large money" comes from
 * volume and from the uncapped `payout_transfers.amount_cents` /
 * `gift_cards.amount`, never from an impossible row. No client or DB maximum
 * for `profiles.bio` was found (grep of maxLength / CHECK); 1000 is used.
 */
import type { Database } from "@/integrations/supabase/types";
import {
  ADMIN_ID,
  CUSTOMER_ID,
  DATE,
  HELPER_ID,
  JOB_BASE,
  SEED_TABLES,
  browseRowsFrom,
} from "./seedData";

type Tables = Database["public"]["Tables"];
type Ins<K extends keyof Tables> = Tables[K]["Insert"];

const NOW = "2026-08-14T12:00:00.000Z";
const AGO = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const MIN_AGO = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

/** `<prefix>000000-0000-4000-8000-<12 hex>` — fixed, unique per prefix. */
const hid = (prefix: string, n: number) =>
  `${prefix.padEnd(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Repeat a phrase to an exact character length (by code point, so emoji are never split). */
function toLength(phrase: string, length: number): string {
  const cps = Array.from(phrase + " ");
  const out: string[] = [];
  for (let i = 0; out.length < length; i++) out.push(cps[i % cps.length]);
  return out.join("").trimEnd().padEnd(length, ".");
}

// ── Profiles ─────────────────────────────────────────────────────────────────
const NAME_POOL = [
  "Marie-Thérèse Boudreaux-Fontenot de la Houssaye",
  "Nguyễn Thị Minh Khai",
  "Jean-Baptiste Émile Arceneaux-Thibodeaux III",
  "李小龍",
  "محمد عبد الرحمن الحسيني",
  "Ōkubo Takeshi",
  "Siobhán Ní Bhriain-Delacroix",
  "Zoë 🌶️ Landry",
  "Christopher Alexander Montgomery-Wellington",
  "Björk Guðmundsdóttir",
  "Αλέξανδρος Παπαδόπουλος",
  "Dmitri Ivanovich Rostropovich-Guidry",
  "Prudence 'Pru' Hebert-LeBlanc-Mouton",
  "José María Ñúñez-Castañeda",
  "Ngozi Chimamanda Adichie-Batiste",
];

const BIO_1000 = toLength(
  "Born and raised in Acadiana 🦞 — I have spent twenty-two years fixing, hauling, painting and cleaning across Lafayette, St. Martin, Iberia and Vermilion parishes. Licensed, insured, bonded. I bring my own ladders, tarps, drop cloths, a 16-foot trailer and a truck that has never once failed to start. Bilingual (English / Cajun French), comfortable around dogs, cats, chickens and one very opinionated parrot. Ask me about storm shutters, pier-and-beam leveling, or getting a crawfish boiler to temperature in a crosswind.",
  1000,
);

export const HEAVY_PROFILES = Array.from({ length: 45 }, (_, i) => ({
  id: `${hid("5e", i + 1)}-profile`,
  user_id: hid("5e", i + 1),
  full_name: `${NAME_POOL[i % NAME_POOL.length]}${i >= NAME_POOL.length ? ` ${i + 1}` : ""}`,
  avatar_url: null,
  email: `heavy.applicant.with.a.very.long.address.${i + 1}@louisiana-helpr-testing.example`,
  location: "St. Martinville, Louisiana, United States of America",
  parish: "St. Martin",
  bio: BIO_1000,
  skills: "handyman,moving,cleaning,yard_work,painting,assembly,pet_care,errands,delivery,events,storm_prep",
  hourly_rate: 45 + i,
  subscription_tier: ["free", "pro", "elite"][i % 3],
  approval_status: "approved",
  ban_status: "active",
  idv_status: i % 4 === 0 ? "not_started" : "verified",
  created_at: AGO(30 + i * 9),
  updated_at: NOW,
})) satisfies Ins<"profiles">[];

// ── The job with 45 applicants ───────────────────────────────────────────────
export const HEAVY_BIG_JOB_ID = hid("1e", 1);

const LONG_TITLE = toLength(
  "Complete post-hurricane cleanup of a raised Acadian cottage: tear out soaked drywall, haul debris, mold-treat the crawlspace and re-hang every shutter 🌀",
  150,
);
const LONG_DESCRIPTION = toLength(
  "The water reached thirty-one inches inside. Everything below that line needs to come out: drywall, insulation, baseboards, the lower kitchen cabinets and the water heater closet door. Debris goes to the curb in separate piles (the parish contractor will not take mixed loads). After tear-out, the crawlspace needs a mold treatment and two dehumidifiers running for 72 hours — I have both. Shutters: fourteen, all original cypress, stacked in the shed and labeled. Please bring respirators; I will reimburse N95s. Access code 8812#, generator is in the back, do not run it inside the carport. Référence: DOSSIER-FEMA-2026-00000000000000000000000000000000000000000000. ",
  5000,
);

const JOB_POSTERS = [CUSTOMER_ID, "00000000-0000-4000-8000-0000000000a3", ...HEAVY_PROFILES.slice(0, 10).map((p) => p.user_id)];
const CATEGORIES = ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other", "storm_prep", "events"] as const;
const PARISHES = ["Orleans", "Jefferson", "East Baton Rouge", "Lafayette", "St. Tammany", "Calcasieu", "Caddo", "St. Martin", "Terrebonne", "St. Landry"];
const TITLE_POOL = [
  "Mow, edge and blow a corner lot 🌿",
  "Déménagement: 3 chambres, 2e étage, pas d'ascenseur",
  "Assemble IKEA PAX wardrobe ×4 — 有说明书",
  "🐶🐶🐶 Walk three huskies twice a day for a week",
  "Supercalifragilisticexpialidociousfencerepairandrepaintingjob",
  "Clean gutters",
  "Set up tents, tables, lights and a dance floor for a 250-guest wedding reception at a plantation venue",
  "Grocery run 🛒 + pharmacy + dry cleaning pickup",
  "Paint a 40-foot fence — two coats, oil-based",
  "Board up windows before landfall ⚠️",
];

const heavyOpenJobs = Array.from({ length: 110 }, (_, i) => ({
  ...JOB_BASE,
  id: hid("1e", 100 + i),
  title: TITLE_POOL[i % TITLE_POOL.length],
  description: i % 7 === 0 ? LONG_DESCRIPTION : toLength(TITLE_POOL[(i + 3) % TITLE_POOL.length], 240),
  category: CATEGORIES[i % CATEGORIES.length],
  status: "open" as const,
  payment_status: "escrow",
  budget: [10, 45, 180, 999, 2500, 4999, 5000][i % 7],
  urgent_fee: i % 5 === 0 ? 5000 : null,
  is_urgent: i % 5 === 0,
  is_group_job: i % 9 === 0,
  helpers_needed: i % 9 === 0 ? 12 : 1,
  location: "Saint-Martinville-sur-le-Bayou-Tèche, Louisiana",
  parish: PARISHES[i % PARISHES.length],
  date_needed: DATE(1 + (i % 28)),
  created_at: MIN_AGO(i * 37),
  customer_id: JOB_POSTERS[i % JOB_POSTERS.length],
})) satisfies Ins<"jobs">[];

const bigJob = {
  ...JOB_BASE,
  id: HEAVY_BIG_JOB_ID,
  title: LONG_TITLE,
  description: LONG_DESCRIPTION,
  category: "storm_prep" as const,
  status: "open" as const,
  payment_status: "escrow",
  budget: 5000,
  urgent_fee: 5000,
  is_urgent: true,
  location: "1234 Rue de la Paix Extraordinairement Longue, Apartment 5B, Saint-Martinville, LA 70582",
  parish: "St. Martin",
  special_requirements: toLength("Respirators required. Bring a 20-yard dumpster permit if you have one. ", 500),
  date_needed: DATE(2),
  created_at: AGO(0),
  customer_id: CUSTOMER_ID,
} satisfies Ins<"jobs">;

export const HEAVY_THREAD_JOB_ID = hid("1e", 2);
const threadJob = {
  ...JOB_BASE,
  id: HEAVY_THREAD_JOB_ID,
  title: "Full gut renovation of a shotgun double — weekly check-ins until done 🏚️➡️🏡",
  description: LONG_DESCRIPTION,
  category: "handyman" as const,
  status: "in_progress" as const,
  payment_status: "escrow",
  budget: 5000,
  location: "New Orleans, LA",
  parish: "Orleans",
  date_needed: DATE(0),
  created_at: AGO(90),
  customer_id: CUSTOMER_ID,
  helper_id: HELPER_ID,
} satisfies Ins<"jobs">;

/** 60 completed, released jobs: the earnings history that overflows a column. */
const heavyCompleted = Array.from({ length: 60 }, (_, i) => ({
  ...JOB_BASE,
  id: hid("1e", 300 + i),
  title: TITLE_POOL[(i + 5) % TITLE_POOL.length],
  description: "Completed.",
  category: CATEGORIES[(i + 2) % CATEGORIES.length],
  status: "completed" as const,
  payment_status: "released",
  budget: 3000 + ((i * 97) % 2001),
  urgent_fee: i % 4 === 0 ? 5000 : null,
  platform_fee_amount: Math.round((3000 + ((i * 97) % 2001)) * 12) / 100,
  helper_fee_percent: 12,
  location: "Lafayette, LA",
  parish: PARISHES[i % PARISHES.length],
  date_needed: DATE(-(3 + i * 6)),
  helper_completed_at: AGO(3 + i * 6),
  poster_confirmed_at: AGO(3 + i * 6),
  created_at: AGO(5 + i * 6),
  customer_id: i % 2 === 0 ? CUSTOMER_ID : HEAVY_PROFILES[i % 45].user_id,
  helper_id: HELPER_ID,
})) satisfies Ins<"jobs">[];

// ── Applications: 45 on the big job ──────────────────────────────────────────
const heavyApplications = HEAVY_PROFILES.map((p, i) => ({
  id: hid("2e", i + 1),
  job_id: HEAVY_BIG_JOB_ID,
  helper_id: p.user_id,
  status: (i === 0 ? "accepted" : i % 11 === 0 ? "rejected" : "pending") as "accepted" | "rejected" | "pending",
  message:
    i % 3 === 0
      ? toLength("I have done eleven post-storm tear-outs since Ida and can start tomorrow at 6am with a crew of three. ", 1000)
      : i % 3 === 1
        ? "🙏🏽🙏🏽🙏🏽"
        : "Available. 有空。متاح. Disponible.",
  created_at: MIN_AGO(i * 13),
  updated_at: MIN_AGO(i * 13),
})) satisfies Ins<"applications">[];

// ── The 220-message thread ───────────────────────────────────────────────────
const MESSAGE_4000 = toLength(
  "Here is the full punch list from today's walkthrough, room by room, so nothing gets lost between visits: ",
  4000,
);
const heavyThread = Array.from({ length: 220 }, (_, i) => {
  const fromCustomer = i % 2 === 0;
  const kind = i % 10;
  const content =
    kind === 0 ? MESSAGE_4000
    : kind === 3 ? "👍👍👍🔥🔥🔥🎉🎉🎉🦞🦞🦞"
    : kind === 5 ? "NOSPACESNOSPACESNOSPACESNOSPACESNOSPACESNOSPACESNOSPACESNOSPACESNOSPACES"
    : kind === 7 ? "明天早上八点可以吗？ / غدا في الساعة الثامنة؟ / Demain à 8h ?"
    : `Update ${i + 1}: ${TITLE_POOL[i % TITLE_POOL.length]}`;
  return {
    id: hid("3e", i + 1),
    job_id: HEAVY_THREAD_JOB_ID,
    sender_id: fromCustomer ? CUSTOMER_ID : HELPER_ID,
    receiver_id: fromCustomer ? HELPER_ID : CUSTOMER_ID,
    content,
    created_at: MIN_AGO((220 - i) * 47),
    read: i < 212,
    is_system: false,
  };
}) satisfies Ins<"messages">[];

// ── Money ────────────────────────────────────────────────────────────────────
const heavyPayouts = [
  ...heavyCompleted.map((j, i) => ({
    id: hid("64e", i + 1),
    job_id: j.id,
    helper_id: HELPER_ID,
    amount_cents: Math.round(j.budget * 88),
    platform_fee_cents: Math.round(j.budget * 12),
    currency: "usd",
    status: "paid",
    initiated_by: "system",
    stripe_account_id: "acct_seed_smoke_helper",
    stripe_transfer_id: `tr_heavy_${i + 1}`,
    created_at: j.helper_completed_at,
    paid_at: j.helper_completed_at,
    jobs: { title: j.title },
  })),
  {
    id: hid("64e", 999),
    job_id: HEAVY_THREAD_JOB_ID,
    helper_id: HELPER_ID,
    amount_cents: 25_000_000,
    platform_fee_cents: 3_409_091,
    currency: "usd",
    status: "pending",
    initiated_by: "admin",
    initiated_by_user_id: ADMIN_ID,
    stripe_account_id: "acct_seed_smoke_helper",
    created_at: AGO(0),
    paid_at: null,
    jobs: { title: threadJob.title },
  },
];

const heavyTips = heavyCompleted.slice(0, 30).map((j, i) => ({
  id: hid("65e", i + 1),
  job_id: j.id,
  tipper_id: CUSTOMER_ID,
  helper_id: HELPER_ID,
  amount: i % 3 === 0 ? 1000 : 999.99,
  source: i % 2 === 0 ? "manual" : "auto",
  payment_status: "paid",
  created_at: j.helper_completed_at,
})) satisfies Ins<"tips">[];

// ── Notifications and reviews ────────────────────────────────────────────────
const NOTIF_TYPES = ["info", "success", "warning", "job_update", "application", "review", "payment", "job_match", "message", "financial_alerts"];
const heavyNotifications = [CUSTOMER_ID, HELPER_ID].flatMap((uid, u) =>
  Array.from({ length: 60 }, (_, i) => ({
    id: hid("4e", u * 100 + i + 1),
    user_id: uid,
    type: NOTIF_TYPES[i % NOTIF_TYPES.length],
    title: i % 4 === 0 ? toLength("🎉 A very long notification title that will not fit on one line of a phone ", 120) : "Heads up",
    message: i % 3 === 0 ? toLength("Marie-Thérèse Boudreaux-Fontenot de la Houssaye applied to your job and wrote a long note. ", 500) : "$250,000.00 payout scheduled",
    read: i > 8,
    created_at: MIN_AGO(i * 90),
  })),
) satisfies Ins<"notifications">[];

const heavyReviews = heavyCompleted.slice(0, 50).map((j, i) => ({
  id: hid("4f", i + 1),
  job_id: j.id,
  reviewer_id: j.customer_id,
  reviewee_id: HELPER_ID,
  rating: [5, 5, 4, 1, 3][i % 5],
  feedback: i % 2 === 0 ? toLength("Absolutely incredible work from start to finish — would hire again in a heartbeat 🌟 ", 1000) : "👌",
  created_at: j.helper_completed_at,
  feedback_visible_at: j.helper_completed_at,
})) satisfies Ins<"reviews">[];

// ── Assemble: normal seed + heavy rows ───────────────────────────────────────
const add = (table: string, extra: unknown[]) => [...(SEED_TABLES[table] ?? []), ...extra];

const jobs = add("jobs", [bigJob, threadJob, ...heavyOpenJobs, ...heavyCompleted]);
const applications = add("applications", heavyApplications);

export const HEAVY_TABLES: Record<string, unknown[]> = {
  ...SEED_TABLES,
  profiles: add("profiles", HEAVY_PROFILES),
  jobs,
  applications,
  messages: add("messages", heavyThread),
  notifications: add("notifications", heavyNotifications),
  reviews: add("reviews", heavyReviews),
  payout_transfers: add("payout_transfers", heavyPayouts),
  tips: add("tips", heavyTips),
  gift_cards: add("gift_cards", [
    {
      id: hid("70e", 1),
      donor_id: HEAVY_PROFILES[0].user_id,
      recipient_id: CUSTOMER_ID,
      amount: 99_999.99,
      status: "available",
      payment_status: "paid",
      message: toLength("For everything you did for the parish after the storm 💛 ", 500),
      created_at: AGO(1),
    },
  ] satisfies Ins<"gift_cards">[]),
  open_jobs_browse: browseRowsFrom(jobs as Record<string, unknown>[], applications as Record<string, unknown>[]),
};

/** Exposed for the heavy-seed test so the contents list above is checked, not trusted. */
export const HEAVY_COUNTS = {
  bigJobApplicants: heavyApplications.length,
  extraOpenJobs: heavyOpenJobs.length,
  threadMessages: heavyThread.length,
  bioLength: Array.from(BIO_1000).length,
  titleLength: Array.from(LONG_TITLE).length,
  longestMessage: MESSAGE_4000.length,
};
