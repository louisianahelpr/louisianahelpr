/**
 * Which Stripe mode a payment runs in: TEST for test accounts, LIVE for
 * everyone else (owner decision 2026-10-12, pop-up "Test mode for test
 * accounts").
 *
 * Stripe has been LIVE on prod since 2026-09-27, so the hire-and-pay journeys
 * that run on the shared test accounts could only create checkouts and never
 * pay them (a live checkout takes no test card, and paying it would move real
 * money). From here on, a payment whose every party is a TEST ACCOUNT runs on
 * the Stripe TEST key (`STRIPE_TEST_SECRET_KEY`) and is paid with test cards;
 * every other payment runs on the live key (`STRIPE_SECRET_KEY`), exactly as
 * before.
 *
 * The rules, decided on the SERVER only (never from anything a client sends):
 *   - A TEST ACCOUNT is a row in public.test_accounts AND profiles.is_seed,
 *     the same definition the launch switch uses (seed_hidden_for,
 *     20261007033530). public.test_accounts has no client grant: only the
 *     service role can enrol an account, so no sign-up can make itself one.
 *   - Every party test -> TEST. No party test -> LIVE. Any mix -> REFUSED: no
 *     money moves on a job that pairs a real person with a test account, in
 *     either mode.
 *   - LIVE always reads STRIPE_SECRET_KEY and never the test key, so a real
 *     user can never reach test mode; TEST reads only STRIPE_TEST_SECRET_KEY
 *     and refuses unless it is a test-mode key, so a test account can never
 *     reach live mode, even through a misconfigured secret.
 *   - A failed read of test_accounts/profiles refuses the payment (fail
 *     closed): which mode applies is unknown, and guessing either way breaks
 *     one of the two rules above.
 *
 * ZERO imports on purpose: the edge test harness runs this real module, and it
 * never constructs a Stripe client itself (each function does, with the key
 * this module returns), so the harness's Stripe double sees the chosen key.
 */

export type StripeMode = "live" | "test";

/** The live key. Real users, and every job with no test-account party. */
const LIVE_KEY_ENV = "STRIPE_SECRET_KEY";
/** The test key. Test accounts only. */
const TEST_KEY_ENV = "STRIPE_TEST_SECRET_KEY";
/** Signing secret(s) of the TEST-mode webhook endpoint (comma-separated). */
export const TEST_WEBHOOK_SECRET_ENV = "STRIPE_TEST_WEBHOOK_SECRET";

export type StripeModeRefusalReason =
  | "mixed_parties"
  | "test_key_missing"
  | "test_key_not_test"
  | "lookup_failed";

/**
 * A payment that must not run in either mode. `publicMessage` is written for
 * people; `message` carries the detail for the logs.
 */
export class StripeModeRefused extends Error {
  readonly reason: StripeModeRefusalReason;
  readonly publicMessage: string;
  constructor(reason: StripeModeRefusalReason, message: string) {
    super(message);
    this.name = "StripeModeRefused";
    this.reason = reason;
    this.publicMessage = reason === "mixed_parties"
      ? "This job pairs a test account with a real account, so no money can move on it."
      : "Payments are unavailable for this account right now. No money was moved.";
  }
}

// deno-lint-ignore no-explicit-any
const readEnv = (name: string): string | undefined => (globalThis as any).Deno?.env?.get(name) ?? undefined;

const uniqIds = (ids: ReadonlyArray<string | null | undefined>): string[] =>
  [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];

/** Pure decision: every party test -> test, none -> live, any mix -> refused. No party -> live. */
export function decideStripeMode(
  parties: ReadonlyArray<{ id: string; test: boolean }>,
): { ok: true; mode: StripeMode } | { ok: false; reason: "mixed_parties" } {
  if (parties.length === 0) return { ok: true, mode: "live" };
  const tests = parties.filter((p) => p.test).length;
  if (tests === 0) return { ok: true, mode: "live" };
  if (tests === parties.length) return { ok: true, mode: "test" };
  return { ok: false, reason: "mixed_parties" };
}

/**
 * Which of `ids` are TEST ACCOUNTS (public.test_accounts row AND
 * profiles.is_seed). `db` must be a SERVICE-ROLE client: test_accounts has no
 * client grant. Throws StripeModeRefused("lookup_failed") on a failed read.
 */
async function loadTestAccountIds(
  // deno-lint-ignore no-explicit-any
  db: any,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Set<string>> {
  const wanted = uniqIds(ids);
  if (wanted.length === 0) return new Set();
  const enrolledRes = await db.from("test_accounts").select("user_id").in("user_id", wanted);
  if (enrolledRes?.error || !Array.isArray(enrolledRes?.data)) {
    throw new StripeModeRefused("lookup_failed", `test_accounts read failed: ${enrolledRes?.error?.message ?? "no rows array"}`);
  }
  // Intersected with `wanted` as well as filtered by `.in()`: an id is a test
  // account only when it was asked about AND came back.
  const asked = new Set(wanted);
  const enrolled = uniqIds((enrolledRes.data as Array<{ user_id?: string | null }>).map((r) => r.user_id))
    .filter((id) => asked.has(id));
  if (enrolled.length === 0) return new Set();
  const seedRes = await db.from("profiles").select("user_id, is_seed").in("user_id", enrolled).eq("is_seed", true);
  if (seedRes?.error || !Array.isArray(seedRes?.data)) {
    throw new StripeModeRefused("lookup_failed", `profiles is_seed read failed: ${seedRes?.error?.message ?? "no rows array"}`);
  }
  // is_seed re-checked on the row as well as filtered by `.eq()`.
  const seed = new Set(uniqIds(
    (seedRes.data as Array<{ user_id?: string | null; is_seed?: boolean | null }>).filter((r) => r.is_seed === true).map((r) => r.user_id),
  ));
  return new Set(enrolled.filter((id) => seed.has(id)));
}

/**
 * The mode for a payment between these parties (nulls ignored: a job with no
 * Helpr yet, a deleted account). Throws StripeModeRefused on a mix or a failed
 * read.
 */
export async function stripeModeForParties(
  // deno-lint-ignore no-explicit-any
  db: any,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<StripeMode> {
  const parties = uniqIds(ids);
  const tests = await loadTestAccountIds(db, parties);
  const decided = decideStripeMode(parties.map((id) => ({ id, test: tests.has(id) })));
  if (!decided.ok) {
    throw new StripeModeRefused("mixed_parties", `parties mix test accounts and real accounts: ${parties.length} parties, ${tests.size} test`);
  }
  return decided.mode;
}

/**
 * Everyone a job's money touches: the poster, the hired Helpr, every crew
 * member of a group job. Throws StripeModeRefused("lookup_failed") on a failed
 * read; a job that does not exist has no parties.
 */
async function jobPartyIds(
  // deno-lint-ignore no-explicit-any
  db: any,
  jobId: string | null | undefined,
): Promise<string[]> {
  return (await readJobParties(db, jobId)).partyIds;
}

/** A job as the mode decision sees it. */
export interface JobParties {
  /** The poster, who funded the escrow (null once the poster's account is gone). */
  payerId: string | null;
  /** Whoever the escrow pays out to: the hired Helpr and every crew member. */
  payeeIds: string[];
  /** Payer and payees together. */
  partyIds: string[];
  /** jobs.stripe_session_id: its cs_test_/cs_live_ prefix says which mode took the money. */
  storedSessionId: string | null;
}

/** Read a job's parties and stored Checkout Session. Throws StripeModeRefused("lookup_failed"). */
export async function readJobParties(
  // deno-lint-ignore no-explicit-any
  db: any,
  jobId: string | null | undefined,
): Promise<JobParties> {
  const none: JobParties = { payerId: null, payeeIds: [], partyIds: [], storedSessionId: null };
  if (typeof jobId !== "string" || jobId.length === 0) return none;
  const jobRes = await db.from("jobs").select("customer_id, helper_id, stripe_session_id").eq("id", jobId).maybeSingle();
  if (jobRes?.error) {
    // 22P02: not a uuid at all, so no job has that id. The action's own read
    // answers "not found"; this is not a failed read (lh-money-escrow
    // re-review 2026-10-12, finding 3).
    if (jobRes.error.code === "22P02") return none;
    throw new StripeModeRefused("lookup_failed", `job read failed: ${jobRes.error.message ?? String(jobRes.error)}`);
  }
  const job = jobRes?.data as { customer_id?: string | null; helper_id?: string | null; stripe_session_id?: string | null } | null;
  if (!job) return none;
  const crewRes = await db.from("group_job_helpers").select("job_id, helper_id").eq("job_id", jobId);
  if (crewRes?.error) {
    throw new StripeModeRefused("lookup_failed", `group_job_helpers read failed: ${crewRes.error.message ?? String(crewRes.error)}`);
  }
  const crew = Array.isArray(crewRes?.data) ? (crewRes.data as Array<{ helper_id?: string | null }>).map((r) => r.helper_id) : [];
  const payerId = typeof job.customer_id === "string" && job.customer_id.length > 0 ? job.customer_id : null;
  const payeeIds = uniqIds([job.helper_id, ...crew]);
  return {
    payerId,
    payeeIds,
    partyIds: uniqIds([payerId, ...payeeIds]),
    storedSessionId: typeof job.stripe_session_id === "string" ? job.stripe_session_id : null,
  };
}

/**
 * What a payment does with a job's money, which decides whose mode counts:
 *   - "new":    takes NEW money (escrow checkout, tip, a visit charge): every
 *               party must share one mode, a mix refuses.
 *   - "payout": pays money ALREADY taken out to the Helpr(s).
 *   - "refund": returns money already taken to the payer, and nothing else.
 *   - "read":   only reads or flips state (verifying a charge).
 * For money already taken, WHERE IT SITS decides (the stored Checkout
 * Session's cs_test_/cs_live_ prefix), not who is enrolled today: a real
 * poster's live escrow is refunded live even if a test Helpr was hired on it,
 * and a payout refuses when any payee is of the other mode (lh-money-escrow
 * review 2026-10-12, finding 1). With no prefix (a gift-funded job, none yet),
 * every party decides, as for new money.
 */
export type MoneyKind = "new" | "payout" | "refund" | "read";

/**
 * The mode for one action on one job's money (see MoneyKind).
 *
 * `actorId` is whoever acts: the caller, an admin, or null for a cron. A REAL
 * actor never counts (the owner, a real admin, settles a test job in test
 * mode). A TEST actor must be of the money's mode, so a test account never
 * moves live money, and while the seed admin is enrolled it cannot move a real
 * job's money. That last part is a rule about the enrolment, not a structural
 * lock: an admin may update any profile, its own is_seed included
 * (lh-authz-rls review 2026-10-12, finding 3).
 *
 * `extraParties` must also share the mode (e.g. the Helpr a tip pays).
 * Throws StripeModeRefused: "mixed_parties" on a mix, "lookup_failed" on a
 * failed read.
 */
export async function jobMoneyMode(
  // deno-lint-ignore no-explicit-any
  db: any,
  jobId: string | null | undefined,
  opts: {
    kind: MoneyKind;
    actorId?: string | null;
    extraParties?: ReadonlyArray<string | null | undefined>;
    /** Pass when the caller already read it, to save a read. */
    job?: JobParties;
  },
): Promise<StripeMode> {
  const job = opts.job ?? await readJobParties(db, jobId);
  const extra = uniqIds(opts.extraParties ?? []);
  const actor = typeof opts.actorId === "string" && opts.actorId.length > 0 ? opts.actorId : null;
  const tests = await loadTestAccountIds(db, [...job.partyIds, ...extra, actor]);
  const testActor = actor && tests.has(actor) ? [actor] : [];
  const stored = opts.kind === "new" ? null : sessionIdMode(job.storedSessionId);
  if (!stored) {
    // A refund is decided by the payer alone. With the payer's account gone
    // there is no payer to ask, so the job's remaining parties decide.
    const refundByPayer = opts.kind === "refund" && job.payerId !== null;
    const counted = uniqIds([...(refundByPayer ? [job.payerId] : job.partyIds), ...extra]);
    const decided = decideStripeMode(counted.map((id) => ({ id, test: tests.has(id) })));
    if (!decided.ok) {
      throw new StripeModeRefused("mixed_parties", `job ${jobId ?? "none"} (${opts.kind}): ${counted.length} parties, ${tests.size} test`);
    }
    // The parties decide the mode; a test actor must then be of it. A test
    // actor alone never picks TEST mode: on a job with nobody left to decide
    // (poster gone, no Helpr) the money is LIVE and a test actor is refused
    // (lh-money-escrow review of cfb045d28, finding 4).
    if (testActor.length > 0 && decided.mode !== "test") {
      throw new StripeModeRefused("mixed_parties", `job ${jobId ?? "none"} (${opts.kind}): a test account acting on live money`);
    }
    return decided.mode;
  }
  // Sandbox money on a job with NO test account on it (a real job paid before
  // prod went live on 2026-09-27) stays on the live key, exactly as before:
  // a real person's job never reaches the test key, and every caller already
  // skips a test-mode id read under the live key (isTestObjectUnderLiveKey).
  const mode: StripeMode = stored === "test" && !job.partyIds.some((id) => tests.has(id)) ? "live" : stored;
  const mustMatch = uniqIds([...(opts.kind === "payout" ? job.payeeIds : []), ...extra, ...testActor]);
  const off = mustMatch.filter((id) => tests.has(id) !== (mode === "test"));
  if (off.length > 0) {
    throw new StripeModeRefused("mixed_parties", `job ${jobId ?? "none"} (${opts.kind}): its money runs ${mode}-mode and ${off.length} party(ies) are not`);
  }
  return mode;
}

/**
 * Any spelling Postgres accepts as a uuid (upper case, braces, hyphens
 * anywhere between digit groups, none at all), as the canonical lowercase
 * form the database returns; null for anything else. A handler hands the raw
 * value to `.eq()`, and Postgres casts every one of those spellings to the
 * same row (measured on prod 2026-10-12: a braced, upper-case, unhyphenated
 * job id matched it), so the scope check must read them the same way
 * (lh-authz-rls review of the rebuild, finding 1).
 */
function canonicalUuid(value: string): string | null {
  let s = value.trim();
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1);
  s = s.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(s)) return null;
  s = s.toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/**
 * Every email a checkout handler could act on: the buyer's
 * (customer_email, customer_details.email, receipt_email) and any metadata
 * value shaped like one (a gift's recipient_email).
 */
// deno-lint-ignore no-explicit-any
function eventEmails(eventObject: any, metaValues: unknown[]): string[] {
  const found = [
    eventObject?.customer_email,
    eventObject?.customer_details?.email,
    eventObject?.receipt_email,
    ...metaValues,
  ].filter((v): v is string => typeof v === "string" && EMAIL_RE.test(v.trim()));
  // Raw AND lower-cased: a handler matches the value it was given.
  return uniqIds(found.flatMap((e) => [e.trim(), e.trim().toLowerCase()]));
}

/**
 * Who a TEST-mode webhook event is about, so stripe-webhook can refuse one
 * that names a real person or a real person's job. Every UUID in the event
 * object's `metadata` and `client_reference_id` is read as a job id (its
 * poster, Helpr and crew) or a user id (when a profile has it); anything else
 * (a dispute id, a gift card id) names nobody. `ok` is false when any person
 * found is not a test account. An event that names nobody is allowed: its
 * Stripe objects exist only in test mode, so only rows a test-mode payment
 * wrote can hold their ids. Throws StripeModeRefused("lookup_failed").
 */
export async function testEventScope(
  // deno-lint-ignore no-explicit-any
  db: any,
  // deno-lint-ignore no-explicit-any
  eventObject: any,
): Promise<{ ok: boolean; people: number; real: number }> {
  const raw: unknown[] = [];
  const meta = eventObject && typeof eventObject === "object" ? eventObject.metadata : null;
  const metaValues = meta && typeof meta === "object" ? Object.values(meta as Record<string, unknown>) : [];
  raw.push(...metaValues);
  if (eventObject && typeof eventObject === "object") raw.push(eventObject.client_reference_id);
  const uuids = uniqIds(raw.map((v) => (typeof v === "string" ? canonicalUuid(v) : null)));
  // People named by email (lh-authz-rls review of the rebuild, finding 1).
  const emails = eventEmails(eventObject, metaValues);
  const emailPeople: string[] = [];
  if (emails.length > 0) {
    const byEmail = await db.from("profiles").select("user_id").in("email", emails);
    if (byEmail?.error || !Array.isArray(byEmail?.data)) {
      throw new StripeModeRefused("lookup_failed", `profiles by email read failed: ${byEmail?.error?.message ?? "no rows array"}`);
    }
    emailPeople.push(...uniqIds((byEmail.data as Array<{ user_id?: string | null }>).map((r) => r.user_id)));
  }
  // A Connect account carries no metadata: its owner is whoever's profile
  // holds its id (a sandbox id a REAL profile still holds must not be fed
  // test-mode state; lh-money-escrow review 2026-10-12, finding 4).
  const accountOwners: string[] = [];
  if (eventObject && typeof eventObject === "object" && eventObject.object === "account" && typeof eventObject.id === "string") {
    const ownersRes = await db.from("profiles").select("user_id").eq("stripe_account_id", eventObject.id);
    if (ownersRes?.error || !Array.isArray(ownersRes?.data)) {
      throw new StripeModeRefused("lookup_failed", `profiles by account read failed: ${ownersRes?.error?.message ?? "no rows array"}`);
    }
    accountOwners.push(...uniqIds((ownersRes.data as Array<{ user_id?: string | null }>).map((r) => r.user_id)));
  }
  if (uuids.length === 0) {
    const named = uniqIds([...accountOwners, ...emailPeople]);
    const namedTests = await loadTestAccountIds(db, named);
    const realNamed = named.filter((id) => !namedTests.has(id)).length;
    return { ok: realNamed === 0, people: named.length, real: realNamed };
  }
  const jobsRes = await db.from("jobs").select("id").in("id", uuids);
  if (jobsRes?.error || !Array.isArray(jobsRes?.data)) {
    throw new StripeModeRefused("lookup_failed", `jobs read failed: ${jobsRes?.error?.message ?? "no rows array"}`);
  }
  const asked = new Set(uuids);
  const jobIds = uniqIds((jobsRes.data as Array<{ id?: string | null }>).map((r) => r.id)).filter((id) => asked.has(id));
  const people: string[] = [];
  for (const jobId of jobIds) people.push(...(await jobPartyIds(db, jobId)));
  const rest = uuids.filter((id) => !jobIds.includes(id));
  if (rest.length > 0) {
    const usersRes = await db.from("profiles").select("user_id").in("user_id", rest);
    if (usersRes?.error || !Array.isArray(usersRes?.data)) {
      throw new StripeModeRefused("lookup_failed", `profiles read failed: ${usersRes?.error?.message ?? "no rows array"}`);
    }
    const restSet = new Set(rest);
    people.push(...uniqIds((usersRes.data as Array<{ user_id?: string | null }>).map((r) => r.user_id)).filter((id) => restSet.has(id)));
  }
  const everyone = uniqIds([...people, ...accountOwners, ...emailPeople]);
  const tests = await loadTestAccountIds(db, everyone);
  const real = everyone.filter((id) => !tests.has(id)).length;
  return { ok: real === 0, people: everyone.length, real };
}

/** The metadata.kind of every checkout a mode-routed function creates. */
const ROUTED_TEST_CHECKOUT_KINDS = new Set(["job_boost", "onboarding_fee", "background_check", "recurring_visit", "gift_card_purchase"]);

/**
 * True when a Checkout Session came from a function that decides its Stripe
 * mode (create-payment escrow / tip / recurring visit, create-boost-payment,
 * pay-onboarding-fee, create-bgc-payment, create-gift-card-checkout), so a
 * TEST-mode event about it may run. Anything else is refused: a subscription
 * or Pro pass (metadata.tier, billing_cycle), or a kind nobody routes. A gift
 * card must ALSO pass testGiftIsTestToTest.
 */
// deno-lint-ignore no-explicit-any
export function isRoutedTestCheckout(session: any): boolean {
  if (!session || typeof session !== "object" || session.mode !== "payment") return false;
  const meta = (session.metadata && typeof session.metadata === "object" ? session.metadata : {}) as Record<string, unknown>;
  if (meta.tier !== undefined || meta.billing_cycle !== undefined) return false;
  if (meta.type === "tip") return true;
  if (typeof meta.kind === "string") return ROUTED_TEST_CHECKOUT_KINDS.has(meta.kind);
  // An escrow checkout (create-payment action "escrow"): names its job, no kind or type.
  return meta.type === undefined && typeof meta.job_id === "string" && meta.job_id.length > 0;
}

/**
 * Q1750: a TEST-mode gift card (metadata.kind gift_card_purchase) is applied
 * only when its donor AND the account its recipient email belongs to are both
 * test accounts. testEventScope lets an email that names nobody through, but a
 * gift to an address with no account would leave sandbox credit claimable by
 * whoever signs up with it, so a gift needs its recipient to BE a test account.
 * Any other session: true (nothing to add). Throws StripeModeRefused("lookup_failed").
 */
export async function testGiftIsTestToTest(
  // deno-lint-ignore no-explicit-any
  db: any,
  // deno-lint-ignore no-explicit-any
  session: any,
): Promise<boolean> {
  const meta = (session && typeof session === "object" && session.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {}) as Record<string, unknown>;
  if (meta.kind !== "gift_card_purchase") return true;
  const donor = typeof meta.donor_id === "string" ? canonicalUuid(meta.donor_id) : null;
  const email = typeof meta.recipient_email === "string" ? meta.recipient_email.trim().toLowerCase() : "";
  if (!donor || !EMAIL_RE.test(email)) return false;
  const res = await db.from("profiles").select("user_id").eq("email", email);
  if (res?.error || !Array.isArray(res?.data)) {
    throw new StripeModeRefused("lookup_failed", `gift recipient by email read failed: ${res?.error?.message ?? "no rows array"}`);
  }
  const owners = uniqIds((res.data as Array<{ user_id?: string | null }>).map((r) => r.user_id));
  if (owners.length !== 1) return false;
  const tests = await loadTestAccountIds(db, [donor, owners[0]]);
  return tests.has(donor) && tests.has(owners[0]);
}

/** True for a test-mode key prefix. */
export const isTestModeKey = (key: string | undefined | null): boolean => !!key && /^(sk|rk)_test_/.test(key);

/**
 * The secret key for a mode. LIVE returns STRIPE_SECRET_KEY and never the test
 * key. TEST returns STRIPE_TEST_SECRET_KEY, and refuses when it is unset or is
 * not a test-mode key (so a misconfigured secret can never send a test account
 * to live mode).
 */
export function stripeSecretKeyFor(mode: StripeMode): string {
  if (mode === "live") return readEnv(LIVE_KEY_ENV) ?? "";
  const key = readEnv(TEST_KEY_ENV);
  if (!key) throw new StripeModeRefused("test_key_missing", `${TEST_KEY_ENV} is not set; a test account's payment cannot run`);
  if (!isTestModeKey(key)) throw new StripeModeRefused("test_key_not_test", `${TEST_KEY_ENV} is not a test-mode key; refusing`);
  return key;
}

/** The mode a Checkout Session id was minted in, from its prefix (null when it has none). */
export function sessionIdMode(sessionId: string | null | undefined): StripeMode | null {
  if (typeof sessionId !== "string") return null;
  if (sessionId.startsWith("cs_test_")) return "test";
  if (sessionId.startsWith("cs_live_")) return "live";
  return null;
}

/** The JSON answer for a refused mode: 409 for the payment itself, 503 for our own misconfiguration or a failed read. */
export function stripeModeRefusedResponse(err: StripeModeRefused, headers: Record<string, string>): Response {
  const status = err.reason === "mixed_parties" ? 409 : 503;
  console.error(JSON.stringify({ event: "stripe_mode_refused", reason: err.reason, detail: err.message }));
  return new Response(JSON.stringify({ error: err.publicMessage, code: "stripe_mode_refused", reason: err.reason }), {
    headers: { ...headers, "Content-Type": "application/json" },
    status,
  });
}

/**
 * Per-run cache for crons and webhooks that touch many jobs: one client per
 * mode, built on first use with the caller's constructor (this module never
 * imports Stripe), and one test-account read per user.
 */
export function createStripeModeResolver<S>(
  // deno-lint-ignore no-explicit-any
  db: any,
  makeClient: (key: string) => S,
) {
  const clients = new Map<StripeMode, S>();
  const known = new Map<string, boolean>();
  const clientFor = (mode: StripeMode): S => {
    const cached = clients.get(mode);
    if (cached) return cached;
    const made = makeClient(stripeSecretKeyFor(mode));
    clients.set(mode, made);
    return made;
  };
  const modeForParties = async (ids: ReadonlyArray<string | null | undefined>): Promise<StripeMode> => {
    const parties = uniqIds(ids);
    const unknown = parties.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      const tests = await loadTestAccountIds(db, unknown);
      for (const id of unknown) known.set(id, tests.has(id));
    }
    const decided = decideStripeMode(parties.map((id) => ({ id, test: known.get(id) === true })));
    if (!decided.ok) {
      throw new StripeModeRefused("mixed_parties", `parties mix test accounts and real accounts: ${parties.length} parties`);
    }
    return decided.mode;
  };
  return {
    clientFor,
    modeForParties,
    /** The client for these parties' mode. Throws StripeModeRefused on a mix, a failed read or a missing test key. */
    async clientForParties(ids: ReadonlyArray<string | null | undefined>): Promise<{ mode: StripeMode; stripe: S }> {
      const mode = await modeForParties(ids);
      return { mode, stripe: clientFor(mode) };
    },
    /**
     * The client for one action on one job's money (see MoneyKind and
     * jobMoneyMode): money already taken runs where it sits. Throws
     * StripeModeRefused on a mix, a failed read or a missing test key.
     */
    async clientForJob(
      jobId: string | null | undefined,
      kind: MoneyKind,
      extraParties: ReadonlyArray<string | null | undefined> = [],
    ): Promise<{ mode: StripeMode; stripe: S }> {
      const mode = await jobMoneyMode(db, jobId, { kind, extraParties });
      return { mode, stripe: clientFor(mode) };
    },
  };
}
