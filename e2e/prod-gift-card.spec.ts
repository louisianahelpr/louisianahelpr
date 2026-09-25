import { test, expect, type APIRequestContext } from "./prodTest";
import { appendFileSync } from "node:fs";
import { payWithTestCard } from "./stripeCheckoutCard";
import {
  GIFT_COLUMNS,
  cents,
  checkClaimed,
  checkConsumed,
  checkMinted,
  checkPreRegistered,
  checkReserved,
  checkRestored,
  checkSettled,
  checkShortfall,
  type GiftRow,
} from "./giftCardLedger";

// THE GIFT CARD JOURNEY, against PRODUCTION, on a Stripe TEST key (SC-005).
//
// buy → deliver → claim → spend (settled) → spend (shortfall) → cancel → restore
//
// Until this spec, the gift card had never run end to end anywhere: prod held
// 0 gift_cards rows that any writer but a hand-seed had produced, and Stripe's
// test account held 0 PaymentIntents with metadata.kind = gift_card_purchase
// (searched 2026-09-25). Every leg below is a real call to the real edge
// function or RPC the app itself uses; the only browser work is Stripe's hosted
// page (twice) and the recipient opening the emailed claim link.
//
// WHO IS WHO. The DONOR is the shared "helper" account and the RECIPIENT is the
// shared "poster" account, deliberately that way round: the recipient is the one
// who posts and funds jobs with the gift, and every job this spec posts is then
// the poster's, carrying E2E_TITLE_MARKER — so scripts/e2e/prod-lifecycle-sweeper.mjs,
// which runs as the poster before and after this spec in CI, unwinds anything a
// failed run strands. Nothing here is role-gated in the product; any account can
// send or receive a gift.
//
// AMOUNTS. create-gift-card-checkout keys Stripe idempotency on donor +
// recipient + amount for 24h, so a second run inside a day with the same amount
// would be handed the FIRST run's (completed) session. The face value therefore
// varies by the minute: $20.00–$59.99, unique for ~66 hours.
//   gift G0 = X            (bought, claimed)
//   job  A  = $10          → G0 settles A outright, leftover child G1 = X − 10
//   job  B  = ⌊X − 10⌋ + 5 → G1 is short by $4.01–$5.00, paid on Stripe
// That walks BOTH branches of redeem_gift_card and the leftover split with one
// purchase.
//
// BLAST RADIUS — the same structural controls as e2e/prod-lifecycle.spec.ts:
// jobs are posted with parish = null (notify_helpers_on_job_post returns before
// its fan-out), carry E2E_TITLE_MARKER, are never applied to, and are
// cancelled by the spec itself. The gift email goes to the recipient's own
// @mailinator.com test inbox: both accounts are is_seed, so the Q137 seed
// boundary does not withhold it and it never reaches a real person.
//
// RESIDUE, STATED PLAINLY: `gift_cards` has no client DELETE and no is_seed
// column, so each completed run leaves its gift tree behind: G0 and G1 redeemed
// against two cancelled jobs, plus the two replacement gifts restore_gift_card_for_job
// mints (X in total), spendable only by the poster test account. Refunding the
// donation would revoke them, but that pages #ops-alerts ("Gift card charge
// reversed") on every run, which is worse than bounded test credit. A scoped
// purge is queued in docs/OPEN.md.

const SUPABASE_URL = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";

// The donor is the helper seat and the recipient the poster seat (see above).
const DONOR_EMAIL = process.env.PLAYWRIGHT_HELPER_EMAIL;
const DONOR_PASSWORD = process.env.PLAYWRIGHT_HELPER_PASSWORD;
const RECIPIENT_EMAIL = process.env.PLAYWRIGHT_POSTER_EMAIL;
const RECIPIENT_PASSWORD = process.env.PLAYWRIGHT_POSTER_PASSWORD;
const READY = Boolean(DONOR_EMAIL && DONOR_PASSWORD && RECIPIENT_EMAIL && RECIPIENT_PASSWORD);

/**
 * OPTIONAL, read-only here: lets the spec read the two Checkout Sessions back
 * from Stripe and check what the card was actually charged. Without it the
 * ledger legs still run and the Stripe-side amounts are announced as unchecked.
 */
const STRIPE_KEY = process.env.STRIPE_TEST_SECRET_KEY;

/** Shared with the sweeper. Changing it orphans every row the sweeper knows about. */
const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]";
const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

type Session = { access_token: string; user: { id: string; email?: string } };

function announceUncovered(title: string, detail: string) {
  console.log(`::warning title=${title}::${detail}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `- **${title}.** ${detail}\n`);
    } catch {
      // The ::warning:: above still lands; an unwritable summary is not a test failure.
    }
  }
}

async function signIn(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(r.ok(), `sign-in failed for ${email}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as Session;
}

const rest = (s: Session) => ({ apikey: ANON, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" });

async function fn(api: APIRequestContext, s: Session, name: string, data: Record<string, unknown>) {
  const r = await api.post(`${SUPABASE_URL}/functions/v1/${name}`, { headers: rest(s), data });
  const text = await r.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a gateway error page): keep the text so the assertion message shows it.
    body = { raw: text.slice(0, 300) };
  }
  return { status: r.status(), body };
}

async function gifts(api: APIRequestContext, s: Session, filter: string): Promise<GiftRow[]> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/gift_cards?select=${GIFT_COLUMNS}&${filter}&order=created_at.asc`, {
    headers: rest(s),
  });
  expect(r.ok(), `reading gift_cards (${filter}): ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as GiftRow[];
}

async function oneGift(api: APIRequestContext, s: Session, id: string): Promise<GiftRow> {
  const rows = await gifts(api, s, `id=eq.${id}`);
  expect(rows, `gift ${id} is not readable by this party`).toHaveLength(1);
  return rows[0];
}

async function readJob(api: APIRequestContext, s: Session, id: string) {
  const r = await api.get(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}&select=id,status,payment_status,stripe_session_id,parish,is_seed`,
    { headers: rest(s) },
  );
  expect(r.ok(), `reading job ${id}: ${r.status()}`).toBe(true);
  const rows = await r.json();
  expect(rows, `job ${id} vanished`).toHaveLength(1);
  return rows[0] as { id: string; status: string; payment_status: string; stripe_session_id: string | null; parish: string | null; is_seed: boolean };
}

async function postJob(api: APIRequestContext, s: Session, runId: string, leg: string, budget: number) {
  // `select=` is mandatory: bare return=representation is RETURNING * and jobs
  // has no table-level SELECT for authenticated (20260915045110).
  const r = await api.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,parish,is_seed,budget`, {
    headers: { ...rest(s), Prefer: "return=representation" },
    data: {
      customer_id: s.user.id,
      title: `${E2E_TITLE_MARKER} gift card ${leg} ${runId}`,
      description:
        "Automated end-to-end test row. Not a real job. Funded with a test gift card and cancelled by CI; " +
        "if you are reading this in the app, something has gone wrong with the test harness.",
      category: "cleaning",
      budget,
      location: "Baton Rouge, LA",
      date_needed: new Date().toISOString().slice(0, 10),
      status: "open",
      payment_status: "unpaid",
      pricing_mode: "set_price",
      parish: null,
      is_seed: true,
    },
  });
  expect(r.ok(), `job ${leg} insert failed: ${r.status()} ${await r.text()}`).toBe(true);
  const [job] = await r.json();
  expect(job.parish, "parish must be null or the helper fan-out fires").toBeNull();
  expect(job.is_seed, "the recipient is a seed account, so its job must be is_seed").toBe(true);
  expect(Number(job.budget)).toBe(budget);
  return job.id as string;
}

async function stripeSession(id: string): Promise<Record<string, unknown> | null> {
  if (!STRIPE_KEY) return null;
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  expect(r.ok, `Stripe session ${id}: HTTP ${r.status}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

const sessionIdOf = (url: string) => /\/(cs_test_[A-Za-z0-9]+)/.exec(url)?.[1] ?? null;
const noViolations = (label: string, violations: string[]) =>
  expect(violations, `${label}:\n  ${violations.join("\n  ")}`).toEqual([]);

test.describe.serial("gift card journey against production", () => {
  test.skip(
    !READY,
    "Set PLAYWRIGHT_POSTER_EMAIL / _PASSWORD and PLAYWRIGHT_HELPER_EMAIL / _PASSWORD. Until then the gift " +
      "card has NO end-to-end coverage (SC-005) — buy, claim and redeem run nowhere.",
  );

  // Shared across the two tests: the second one cancels what the first funded.
  const state: {
    donor?: Session;
    recipient?: Session;
    g0?: GiftRow;
    g1Id?: string;
    jobA?: string;
    jobB?: string;
    faceCents?: number;
  } = {};

  test("buy, deliver, claim and spend a gift card", async ({ page, request }) => {
    test.setTimeout(6 * 60_000);
    const t0 = Date.now();
    const startedAt = new Date(t0 - 5_000).toISOString();
    const donor = await signIn(request, DONOR_EMAIL!, DONOR_PASSWORD!);
    const recipient = await signIn(request, RECIPIENT_EMAIL!, RECIPIENT_PASSWORD!);
    expect(donor.user.id, "donor and recipient resolved to the same account").not.toBe(recipient.user.id);
    Object.assign(state, { donor, recipient });

    // Both seats must be seed accounts: that is what keeps the claim email
    // inside the test inboxes and every job out of the is_seed-aware sweeps.
    for (const [who, s] of [["donor", donor], ["recipient", recipient]] as const) {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${s.user.id}&select=is_seed`, { headers: rest(s) });
      expect(r.ok(), `${who} profile read: ${r.status()}`).toBe(true);
      const [row] = await r.json();
      expect(row?.is_seed, `the ${who} test account must be is_seed`).toBe(true);
    }

    const runId = `r${t0.toString(36)}-${process.env.GITHUB_RUN_ID ? `g${Number(process.env.GITHUB_RUN_ID).toString(36)}` : "local"}`;
    const minute = Math.floor(t0 / 60_000);
    const faceCents = 2000 + (minute % 4000);
    state.faceCents = faceCents;
    const recipientEmail = RECIPIENT_EMAIL!.trim().toLowerCase();

    // --- 1. BUY ---------------------------------------------------------------
    // The server is the authority on bounds and on self-gifting; both refusals
    // are asserted before the real purchase so a loosened gate cannot hide.
    const tooSmall = await fn(request, donor, "create-gift-card-checkout", { amount: 5, recipient_email: recipientEmail });
    expect(tooSmall.status, `a $5 gift must be refused: ${JSON.stringify(tooSmall.body)}`).toBe(400);
    expect(String(tooSmall.body.error)).toContain("smallest gift is $10");
    const toSelf = await fn(request, donor, "create-gift-card-checkout", { amount: 20, recipient_email: DONOR_EMAIL });
    expect(toSelf.status, `a gift to yourself must be refused: ${JSON.stringify(toSelf.body)}`).toBe(400);
    expect(String(toSelf.body.error)).toContain("can't send a gift to yourself");

    const bought = await fn(request, donor, "create-gift-card-checkout", {
      amount: faceCents / 100,
      recipient_email: recipientEmail,
      category: "Any",
      message: `${E2E_TITLE_MARKER} ${runId}`,
      occasion: "thank_you",
      design_id: "thanks_parchment",
    });
    expect(bought.status, `create-gift-card-checkout: ${JSON.stringify(bought.body)}`).toBe(200);
    const checkoutUrl = String(bought.body.url ?? "");
    const sessionId = sessionIdOf(checkoutUrl);
    if (!sessionId) {
      // Not cs_test_: the only card this suite has would be a real charge.
      announceUncovered(
        "Gift card journey SKIPPED — Stripe is not in test mode",
        `create-gift-card-checkout returned ${checkoutUrl.slice(0, 60)}. Nothing was paid; the pre-registered row stays pending and inert.`,
      );
      test.skip(true, "Stripe is not in test mode");
      return;
    }

    // Pre-registration: the row exists BEFORE the donor pays, and is inert.
    const [pending] = await gifts(request, donor, `stripe_session_id=eq.${sessionId}`);
    expect(pending, `no pre-registered gift row for ${sessionId}`).toBeTruthy();
    noViolations("pre-registered gift", checkPreRegistered(pending, { donorId: donor.user.id, recipientEmail, faceCents, sessionId, now: t0 }));

    await payWithTestCard(page, checkoutUrl);

    // --- 2. MINT (the webhook, not the redirect, is what makes the gift) ------
    await expect
      .poll(async () => (await oneGift(request, donor, pending.id)).payment_status, {
        timeout: 90_000,
        message: "stripe-webhook never completed the gift (payment_status stayed pending)",
      })
      .toBe("paid");
    const minted = await oneGift(request, donor, pending.id);
    noViolations("minted gift", checkMinted(minted, { preRegisteredId: pending.id, donorId: donor.user.id, recipientId: recipient.user.id, faceCents, now: t0 }));
    // Exactly one row for this session: the mint completed the pending row in place.
    expect(await gifts(request, donor, `stripe_session_id=eq.${sessionId}`)).toHaveLength(1);

    const donation = await stripeSession(sessionId);
    if (donation) {
      const meta = donation.metadata as Record<string, string>;
      expect(donation.livemode).toBe(false);
      expect(donation.payment_status).toBe("paid");
      expect(meta.kind).toBe("gift_card_purchase");
      expect(Number(meta.amount_cents), "Stripe carried a different face value than the gift row").toBe(faceCents);
      expect(donation.payment_intent, "the gift row names a different PaymentIntent than Stripe").toBe(minted.stripe_payment_intent_id);
      const fee = Number(donation.amount_subtotal) - faceCents;
      // The donor pays face + the processing floor (posterServiceFeeCents at 0%).
      expect(fee, `the donor was charged ${donation.amount_subtotal}¢ for a ${faceCents}¢ gift`).toBeGreaterThan(0);
      expect(fee, "the donor's fee is more than a processing floor").toBeLessThan(Math.ceil(faceCents * 0.1));
    } else {
      announceUncovered("Gift card Stripe amounts unchecked", "STRIPE_TEST_SECRET_KEY not set — the ledger legs ran; what the card was charged was not read back.");
    }

    // --- 3. DELIVER -----------------------------------------------------------
    const boundAtMint = minted.recipient_id === recipient.user.id;
    if (boundAtMint) {
      // An already-registered, confirmed recipient is told in-app at once.
      await expect
        .poll(
          async () => {
            const r = await request.get(
              `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${recipient.user.id}&created_at=gte.${startedAt}` +
                `&link=eq.${encodeURIComponent(`/profile?tab=gift_card&user=${donor.user.id}`)}&select=id,title`,
              { headers: rest(recipient) },
            );
            return r.ok() ? ((await r.json()) as { title: string }[]).map((n) => n.title) : [`HTTP ${r.status()}`];
          },
          { timeout: 30_000, message: "the recipient was never notified in-app of the gift" },
        )
        .toContain("You received a Helpr credit!");
    } else {
      announceUncovered(
        "Gift card in-app delivery not exercised",
        "The recipient was not auto-bound at mint (their profile email did not match a confirmed account), so delivery was the email alone; the claim below binds it.",
      );
    }
    // The recipient can see the gift and its claim link token (party-only RLS
    // matches the named email), which is what the emailed link carries.
    const seen = await oneGift(request, recipient, minted.id);
    expect(seen.claim_token, "the recipient cannot read the claim token their email carries").toBe(minted.claim_token);

    // --- 4. CLAIM -------------------------------------------------------------
    // A leaked link is worthless to anyone else: the donor holds the token too.
    const stolen = await fn(request, donor, "claim-gift-card", { claim_token: minted.claim_token });
    expect(stolen.status, `the donor claimed the recipient's gift: ${JSON.stringify(stolen.body)}`).toBe(boundAtMint ? 409 : 403);

    // The recipient opens the emailed link, signed in, exactly as the app does it.
    await page.goto("/");
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTH_STORAGE_KEY, JSON.stringify(recipient)] as const);
    const claimCall = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/functions/v1/claim-gift-card"),
      { timeout: 60_000 },
    );
    await page.goto(`/profile?tab=gift_card&claim=${minted.claim_token}`);
    const claimed = await claimCall;
    const claimBody = (await claimed.json()) as { ok?: boolean; credit_id?: string; already_claimed?: boolean };
    expect(claimed.status(), `claim-gift-card from the link: ${JSON.stringify(claimBody)}`).toBe(200);
    expect(claimBody.ok).toBe(true);
    expect(claimBody.credit_id).toBe(minted.id);
    expect(claimBody.already_claimed, "already_claimed must say whether the webhook had bound it").toBe(boundAtMint);
    await expect(page.getByText(boundAtMint ? "Already yours" : "Gift claimed").first()).toBeVisible({ timeout: 15_000 });
    // The token leaves the address bar once used.
    await expect.poll(() => new URL(page.url()).searchParams.get("claim")).toBeNull();
    const g0 = await oneGift(request, recipient, minted.id);
    noViolations("claimed gift", checkClaimed(g0, { recipientId: recipient.user.id, faceCents }));
    state.g0 = g0;

    // --- 5. SPEND, settled: the gift covers job A outright ----------------------
    const costA = 1000;
    const jobA = await postJob(request, recipient, runId, "A", costA / 100);
    state.jobA = jobA;
    const payA = await fn(request, recipient, "create-payment", { action: "escrow", jobId: jobA, giftCardId: g0.id });
    expect(payA.status, `redeeming the gift on job A: ${JSON.stringify(payA.body)}`).toBe(200);
    expect(String(payA.body.url), "a gift that covers the job must not open a Stripe checkout").toContain(`/payment-success?job_id=${jobA}`);
    const g0After = await oneGift(request, recipient, g0.id);
    const children = await gifts(request, recipient, `parent_credit_id=eq.${g0.id}`);
    noViolations("settled redemption", checkSettled(g0After, children, await readJob(request, recipient, jobA), { costCents: costA, recipientId: recipient.user.id }));
    const g1 = children.find((c) => c.restored_from_job_id === null)!;
    state.g1Id = g1.id;
    // A consumed gift cannot be spent twice (the job is funded, and the gift is redeemed).
    const again = await fn(request, recipient, "create-payment", { action: "escrow", jobId: jobA, giftCardId: g0.id });
    expect(again.status, `re-redeeming a spent gift must fail: ${JSON.stringify(again.body)}`).not.toBe(200);

    // --- 6. SPEND, shortfall: the leftover is smaller than job B ---------------
    const g1Cents = cents(g1.amount);
    const costB = (Math.floor(g1Cents / 100) + 5) * 100;
    const jobB = await postJob(request, recipient, runId, "B", costB / 100);
    state.jobB = jobB;
    const payB = await fn(request, recipient, "create-payment", { action: "escrow", jobId: jobB, giftCardId: g1.id });
    expect(payB.status, `redeeming the leftover on job B: ${JSON.stringify(payB.body)}`).toBe(200);
    const diffUrl = String(payB.body.url ?? "");
    const diffSessionId = sessionIdOf(diffUrl);
    expect(diffSessionId, `a short gift must open a TEST checkout for the difference, got ${diffUrl.slice(0, 80)}`).toBeTruthy();
    noViolations("reserved gift", checkReserved(await oneGift(request, recipient, g1.id), await readJob(request, recipient, jobB)));
    expect((await readJob(request, recipient, jobB)).stripe_session_id, "the difference session is not recorded on the job").toBe(diffSessionId);

    const diff = await stripeSession(diffSessionId!);
    if (diff) {
      const meta = diff.metadata as Record<string, string>;
      expect(meta.gift_card_id).toBe(g1.id);
      expect(meta.job_id).toBe(jobB);
      noViolations("shortfall", checkShortfall(Number(diff.amount_subtotal), { costCents: costB, giftCents: g1Cents }));
    }

    await payWithTestCard(page, diffUrl);
    await expect
      .poll(async () => (await readJob(request, recipient, jobB)).payment_status, {
        timeout: 90_000,
        message: "stripe-webhook never funded job B after the shortfall was paid",
      })
      .toBe("escrow");
    await expect
      .poll(async () => (await oneGift(request, recipient, g1.id)).status, {
        timeout: 30_000,
        message: "the reserved leftover was never consumed",
      })
      .toBe("redeemed");
    noViolations("consumed gift", checkConsumed(await oneGift(request, recipient, g1.id), await readJob(request, recipient, jobB)));

    // The donor's own view agrees: the gift they bought is spent, on the recipient's job.
    expect((await oneGift(request, donor, g0.id)).status).toBe("redeemed");
  });

  // The defect this journey found on its first design pass (2026-09-25, code
  // read, then exercised here): create-payment's cancel_escrow flipped a
  // gift-funded job to cancelled without restore_gift_card_for_job, so the
  // recipient's gift was simply gone — every other cancel/refund exit restores
  // it. Guard for the class: src/test/cancelPathsRestoreGift.test.ts.
  test("cancelling a gift-funded job gives the gift back", async ({ request }) => {
    test.setTimeout(3 * 60_000);
    const { recipient, g0, g1Id, jobA, jobB, faceCents } = state;
    test.skip(!recipient || !g0 || !g1Id || !jobA || !jobB || !faceCents, "the spend test did not get far enough to fund both jobs");

    for (const [leg, jobId] of [["A", jobA!], ["B", jobB!]] as const) {
      const cancelled = await fn(request, recipient!, "create-payment", { action: "cancel_escrow", jobId });
      expect(cancelled.status, `cancel_escrow on job ${leg}: ${JSON.stringify(cancelled.body)}`).toBe(200);
      const job = await readJob(request, recipient!, jobId);
      expect(`${job.status}/${job.payment_status}`).toBe("cancelled/cancelled");
    }

    // Job A took $10 of G0 (the rest had already become G1); job B took all of G1.
    const g1 = await oneGift(request, recipient!, g1Id!);
    noViolations(
      "gift restored from job A",
      checkRestored(await gifts(request, recipient!, `restored_from_job_id=eq.${jobA}`), {
        jobId: jobA!,
        parentId: g0!.id,
        appliedCents: 1000,
        recipientId: recipient!.user.id,
      }),
    );
    noViolations(
      "gift restored from job B",
      checkRestored(await gifts(request, recipient!, `restored_from_job_id=eq.${jobB}`), {
        jobId: jobB!,
        parentId: g1Id!,
        appliedCents: cents(g1.amount),
        recipientId: recipient!.user.id,
      }),
    );
    // Nothing was lost and nothing was conjured: the two replacements add up to the gift.
    const restored = await gifts(request, recipient!, `restored_from_job_id=in.(${jobA},${jobB})`);
    expect(restored.reduce((sum, r) => sum + cents(r.amount), 0), "restored value ≠ the gift's face value").toBe(faceCents);
  });
});

// @mutate-exempt The subject is PRODUCTION edge functions and RPCs reached with the shared test accounts (GitHub secrets only; empty in cloud sessions, measured 2026-09-25): a local source mutation cannot reach prod, so any @mutate here would SURVIVE for an environment reason, not a coverage one. Every assertion the ledger legs make goes through e2e/giftCardLedger.ts, whose checks are proven able to fail by src/test/giftCardJourneyLedger.test.ts (one wrong-in-one-way row per check, with @mutate lines on the checker). The cancel→restore test is itself the red-first proof of the cancel_escrow defect: it fails against the create-payment deployed before this fix.
