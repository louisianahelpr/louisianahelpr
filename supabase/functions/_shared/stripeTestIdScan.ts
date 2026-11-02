/**
 * Q1909: does a REAL (non-seed) row hold a Stripe TEST-mode id?
 *
 * Q1761 keeps sandbox refund notices away from real people, but testEventScope still lets a test-mode event that names
 * nobody through, on the assumption that only rows a test payment wrote hold its ids. sendRefundNotice falls back to
 * gift_cards and tips for a recipient, and a test-mode full refund or dispute revokes a gift card by PaymentIntent, so
 * a real row holding a test id is a real person a sandbox event can reach. money-reconciliation runs this nightly
 * (read only, warning level), the database-side sibling of its stripeTestObjectOnRealJob (which only sees the
 * PaymentIntents it asks Stripe about).
 *
 * What marks an id as TEST, from the row alone (no Stripe call):
 *   - a Checkout Session id starting cs_test_ (a live one starts cs_live_);
 *   - any Stripe id on a row written before Stripe went live on prod (STRIPE_LIVE_SINCE): nothing before it was live
 *     money. A test Connect account cannot be told from its acct_ id; stripe-connect finds those at use time
 *     (isUnusableConnectAccountError), so it is not graded here.
 *
 * Seed-scoped: a row is SEED when its job is is_seed, or any person it names is is_seed or in test_accounts. A row
 * that names no job that still exists and no person is an ORPHAN (a deleted account's ledger row): no event can reach
 * anyone through it, so it is counted, never reported. Everything else is REAL; a failed seed lookup reads as real
 * (a warning on a fixture beats silence).
 */

/** Stripe went live on prod 2026-09-27 (CLAUDE.md). Rows written before it hold test ids only. */
export const STRIPE_LIVE_SINCE = "2026-09-27T00:00:00Z";

export interface TestIdTable {
  table: "jobs" | "recurring_visit_payments" | "payment_refunds" | "payout_transfers" | "gift_cards" | "tips";
  /** The Checkout Session column, when the table has one. */
  session: string | null;
  /** The other Stripe id columns. */
  ids: string[];
  /** The column naming the row's job ("id" for jobs itself). */
  job: string;
  /** The columns naming people (payer, payee, recipient...). */
  people: string[];
}

export const TEST_ID_TABLES: readonly TestIdTable[] = [
  { table: "jobs", session: "stripe_session_id", ids: ["stripe_payment_intent_id"], job: "id", people: ["customer_id", "helper_id"] },
  { table: "recurring_visit_payments", session: "stripe_session_id", ids: ["stripe_payment_intent_id"], job: "parent_job_id", people: ["payer_id", "helper_id"] },
  { table: "payment_refunds", session: null, ids: ["stripe_payment_intent_id", "stripe_refund_id"], job: "job_id", people: ["customer_id"] },
  { table: "payout_transfers", session: null, ids: ["stripe_transfer_id"], job: "job_id", people: ["helper_id"] },
  { table: "gift_cards", session: "stripe_session_id", ids: ["stripe_payment_intent_id"], job: "job_id", people: ["donor_id", "recipient_id"] },
  { table: "tips", session: "stripe_session_id", ids: ["stripe_payment_intent_id"], job: "job_id", people: ["tipper_id", "helper_id"] },
];

/** The columns to read for one table. */
export function testIdColumns(t: TestIdTable): string {
  const cols = new Set<string>(["id", "created_at", t.job, ...t.people, ...t.ids]);
  if (t.session) cols.add(t.session);
  if (t.table === "jobs") cols.add("is_seed");
  return [...cols].join(", ");
}

/** The PostgREST .or() that narrows the read to rows that can carry a marker (the classifier below decides). */
export function testIdOrFilter(t: TestIdTable): string {
  const parts: string[] = [];
  if (t.session) parts.push(`${t.session}.like.cs_test_*`);
  for (const c of t.ids) parts.push(`and(created_at.lt.${STRIPE_LIVE_SINCE},${c}.not.is.null)`);
  if (t.session) parts.push(`and(created_at.lt.${STRIPE_LIVE_SINCE},${t.session}.not.is.null)`);
  return parts.join(",");
}

export type Row = Record<string, unknown>;

/** Which test id this row holds, or null. */
export function testIdMarker(row: Row, t: TestIdTable): { marker: "cs_test_session" | "before_go_live"; column: string } | null {
  const session = t.session ? row[t.session] : null;
  if (typeof session === "string" && session.startsWith("cs_test_")) return { marker: "cs_test_session", column: t.session! };
  const created = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
  if (Number.isFinite(created) && created < Date.parse(STRIPE_LIVE_SINCE)) {
    for (const c of [...(t.session ? [t.session] : []), ...t.ids]) {
      if (typeof row[c] === "string" && (row[c] as string).length > 0) return { marker: "before_go_live", column: c };
    }
  }
  return null;
}

export interface SeedContext {
  /** Jobs the run could read, by id (is_seed). */
  jobs: Map<string, { is_seed: boolean | null }>;
  /** People who are is_seed or in test_accounts. */
  seedPeople: Set<string>;
  /** A seed lookup failed: nothing can be called seed or orphan with certainty, so every hit reads as real. */
  lookupFailed: boolean;
}

/** The ids this row needs looked up. */
export function testIdRefs(row: Row, t: TestIdTable): { job: string | null; people: string[] } {
  const job = typeof row[t.job] === "string" ? (row[t.job] as string) : null;
  const people = t.people.map((c) => row[c]).filter((v): v is string => typeof v === "string" && v.length > 0);
  return { job, people };
}

export function classifyTestIdRow(row: Row, t: TestIdTable, ctx: SeedContext): "real" | "seed" | "orphan" {
  const { job: jobId, people } = testIdRefs(row, t);
  const job = t.table === "jobs" ? { is_seed: (row.is_seed as boolean | null) ?? null } : jobId ? ctx.jobs.get(jobId) : undefined;
  if (job?.is_seed === true) return "seed";
  if (people.some((p) => ctx.seedPeople.has(p))) return "seed";
  if (ctx.lookupFailed) return "real";
  if (!job && people.length === 0) return "orphan";
  return "real";
}
