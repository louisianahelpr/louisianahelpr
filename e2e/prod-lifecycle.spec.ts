import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The full authenticated money loop, against PRODUCTION, on a Stripe TEST key.
//
// post → fund (escrow) → apply → hire → complete → release → payout → review
//
// ============================================================================
// THIS SPEC HAS NEVER EXECUTED. It is gated on secrets that do not exist yet.
// Its assertions are written from the live schema, the live RLS policies and the
// live edge-function action names, all read on 2026-09-07 — but reading is not
// running, and the first real run should be expected to find things wrong with
// THIS FILE before it finds anything wrong with the app.
// ============================================================================
//
// WHY IT MAY WRITE TO PRODUCTION AT ALL
// -------------------------------------
// Because production is on a Stripe TEST key. Verified independently against the
// Stripe API: every charge produced by prod edge functions on 5–6 Sep is
// `livemode: false`, including a Connect destination charge with a transfer — so
// both the funding and payout legs have already run for real on a test card. The
// card is 4242 4242 4242 4242, any future expiry, any CVC.
//
// The owner intends to keep the key on test until every function has been
// verified against Stripe, so this is not a countdown. But it IS a config value
// one person can change, and the funding leg is the single piece of this suite
// that becomes dangerous the moment it does — see the tripwire at
// `stripeModeFromCheckoutUrl` below.
//
// WHAT HAPPENS IF THE KEY EVER GOES LIVE
// --------------------------------------
// The suite DEGRADES; it does not break, and it does not charge anyone.
//   still runs : post → apply → hire → complete  (no card is involved, and an
//                unfunded job is invisible in browse and triggers no
//                notifications, because every one of those gates requires
//                payment_status IN ('escrow','payout_pending','released'))
//   skipped    : fund → release → payout → review, announced as UNCOVERED via
//                a ::warning:: and a step-summary line, never silently
// Review is in the skipped set because it has to be: the
// `Users can create reviews for eligible jobs` policy requires
// `payment_status IN ('released','payout_pending')`. That is where the
// dependency actually lies, not a judgement call made here.
//
// REPLACING THE FUNDING LEG, if that day comes: the proper fix is a SECOND
// Stripe account used only by tests, with its own `sk_test_` key, reached
// through a mode-aware key selection in the edge functions (e.g. an override
// honoured only for these two account ids — `_shared/proTiers.ts` already has
// the shape of such a switch). There is no way to split the difference on one
// account: Stripe rejects test cards in live mode with `card_declined`, and live
// mode accepts only real cards. That work is explicitly NOT done here.
//
// BLAST RADIUS — every mitigation below is structural, not a convention, and
// each was verified against the live database rather than assumed.
//
//  1. ZERO NOTIFICATION FAN-OUT — the job is posted with `parish = null`.
//     `notify_helpers_on_job_post` opens with
//         IF NEW.parish IS NULL OR NEW.status <> 'open' THEN RETURN NEW;
//     so a parish-less job cannot reach the fan-out loop at all. This does not
//     depend on who is signed up: it is the first statement in the trigger.
//     (The demographic argument — 0 rows in `helper_preferred_parishes`, all 17
//     real profiles with `parish = null` — happens to hold too, but it would
//     stop holding the moment someone sets a ZIP, so it is not relied on.)
//
//  2. EFFECTIVELY ZERO BROWSE EXPOSURE — all four guest surfaces
//     (`open_jobs_browse`, `get_ranked_open_jobs`, `get_open_jobs_for_map`,
//     `get_public_open_jobs`) require `created_at <= early_access_cutoff()`,
//     and `early_access_cutoff()` is `now() - 20 minutes` for a free-tier
//     caller. All 17 real profiles are free tier. So a job younger than 20
//     minutes is invisible to every real account, and this suite moves the job
//     off `status = 'open'` within seconds of funding it. The `is_seed` flag is
//     deliberately NOT what is relied on here: `seed_jobs_hidden_publicly()`
//     returns false in prod (the owner is keeping fixtures visible), which
//     makes `is_seed` a launch switch rather than an isolation mechanism.
//
//  3. THE MONEY SWEEPS DO SKIP IT — as of `is_seed_derived_from_the_account`
//     (20260908015405). This control used NOT to exist, and the note here used
//     to explain at length why it could not: `enforce_jobs_insert_column_lock`
//     hard-set `NEW.is_seed := false` on every poster INSERT, so this run's job
//     was always visible to the five sweeps that filter on the flag.
//     That was a design gap, and it surfaced somewhere worse than a sweep: the
//     Post-a-Job budget hint on prod read "Jobs like this pay $25–$25 · Based on
//     15 completed jobs", and all 15 were rows this very suite created.
//     The lock now DERIVES the flag from the posting account
//     (`profiles.is_seed`, itself locked by `prevent_self_escalation`) instead of
//     answering false. It still ignores whatever the client sends — the control
//     that matters is unchanged — it is simply truthful now. Both test accounts
//     are `@mailinator.com`, so they are seed accounts, so this job is a seed
//     job, so `auto-release-payment`, `payment-confirm-reminder`,
//     `money-reconciliation`, `process-scheduled-payouts` and
//     `subscription-reconciliation` all skip it. That is the DESIGNED behaviour,
//     not a leak.
//     Two consequences worth stating plainly. The seven sweeps that ignore the
//     flag still see the job, so controls 1, 2 and 4 plus the sweeper are still
//     what bound this run. And because `auto-release-payment` now skips it, this
//     suite MUST keep calling release-payout directly — which it does; that is
//     its proof path and it does not depend on `is_seed`. `announceUncovered`
//     below reports the residual honestly rather than claiming full isolation.
//     The alternative once contemplated here — a `SECURITY DEFINER` RPC scoped
//     to these two user ids — is no longer needed. Handing CI a service-role key
//     remains REJECTED for the reason the workflow's sweep step states: "a CI job
//     holding service-role could delete anything in the database, which is a far larger
//     risk than the rows it tidies."
//
//  4. THE TITLE SAYS SO. Every row carries E2E_TITLE_MARKER, which is both the
//     human signal and the only handle the sweeper has.
//
// RESIDUE, STATED PLAINLY: a run that COMPLETES leaves one settled job plus its
// application, payout_transfer and review in production, permanently. The
// poster cannot delete them — `Customers can delete their own jobs` requires
// `status = 'open'` and an unfunded or abandoned payment_status — and deleting
// settled money rows would be worse than keeping them. At one push per run that
// is bounded but unbounded-in-time growth on a money schema. The clean fix is a
// `SECURITY DEFINER` purge scoped to these two user ids; that is a migration
// touching authz and is NOT written here.

const SUPABASE_URL = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
// Publishable, and already in every shipped bundle — defaulted so the secret
// list stays down to the four that are genuinely secret.
const ANON =
  process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";

const POSTER_EMAIL = process.env.PLAYWRIGHT_POSTER_EMAIL;
const POSTER_PASSWORD = process.env.PLAYWRIGHT_POSTER_PASSWORD;
const HELPER_EMAIL = process.env.PLAYWRIGHT_HELPER_EMAIL;
const HELPER_PASSWORD = process.env.PLAYWRIGHT_HELPER_PASSWORD;

const READY = Boolean(POSTER_EMAIL && POSTER_PASSWORD && HELPER_EMAIL && HELPER_PASSWORD);

/**
 * The payout leg's credentials. OPTIONAL — without them the loop runs and says
 * out loud that nothing proved the helper was paid.
 *
 * An ACCOUNT, not a secret, and that is the whole point. `release-payout` takes
 * either a JWT carrying `has_role(admin)` or a bearer equal to CRON_SECRET /
 * the service-role key, and the second door was the obvious one to reach for.
 * It is the wrong one. CRON_SECRET authorises 29 edge functions — every money
 * mutation in the system — so handing it to CI is broader custody than the
 * service-role key this workflow already refuses to hold, and it is
 * un-attributable besides: release-payout only stamps `initiated_by_user_id`
 * on the admin branch (index.ts:98), so a secret-authenticated payout lands in
 * the ledger as "someone holding the shared secret". An admin account is
 * narrower, revocable on its own, and signs its name in `payout_transfers`.
 */
const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

/** Shared with the sweeper. Changing it orphans every row the sweeper knows about. */
const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]";

/** Stripe's universally-accepted test card. Only ever valid on a test key. */
const TEST_CARD = {
  number: "4242 4242 4242 4242",
  expiry: "12 / 34",
  cvc: "123",
  zip: "70801",
  name: "Prod Lifecycle Test",
  line1: "100 Audit Way",
  city: "Baton Rouge",
};

/**
 * A REAL image, 68 bytes of valid PNG (1×1, opaque). Written to a temp file so
 * the browser's file picker receives an actual file with actual bytes — the
 * point of the storage leg is that something a browser encoded travels through
 * `supabase.storage.upload()` and lands as an object, so a stub string or a
 * zero-length file would prove nothing.
 */
const PROOF_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * supabase-js persists the web session under `sb-<project-ref>-auth-token`.
 * Derived from SUPABASE_URL rather than hard-coded so retargeting the suite
 * with PLAYWRIGHT_SUPABASE_URL does not silently seed a key the app never
 * reads — which would present as "the app just isn't signed in" with nothing
 * naming the cause.
 */
const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

/**
 * Every object this run put in `proof-photos`, so teardown can remove them.
 * Module scope because the deletion happens in afterEach, after the test body
 * has thrown or returned.
 */
const uploadedProofPaths: string[] = [];

/**
 * THE LIVE-KEY TRIPWIRE.
 *
 * Production's `STRIPE_SECRET_KEY` is a test key today, and the owner intends to
 * keep it that way until every function has been verified against Stripe. This
 * guard is therefore expected to do nothing, indefinitely. It exists for the day
 * someone flips that key.
 *
 * On that day, without this check, the funding leg would type a card number into
 * a LIVE Stripe Checkout on every push. It would not even fail usefully: Stripe
 * rejects `4242 4242 4242 4242` in live mode with `card_declined`, so the suite
 * would go red with a message about a declined card and someone would "fix" it by
 * supplying a real one. That is the whole failure class this workstream exists to
 * catch — a thing that is correct right up until a config change makes it
 * dangerous, with nothing watching.
 *
 * HOW THE MODE IS DETECTED, AND WHY THIS WAY
 * ------------------------------------------
 * From the Checkout Session id embedded in the URL `create-payment` returns:
 * `cs_test_…` or `cs_live_…`. Chosen over the two alternatives because:
 *   * the `sk_test_` / `sk_live_` prefix would require the secret key itself to
 *     be readable by CI. Putting a live Stripe secret into a GitHub Actions
 *     environment to find out whether it is a live Stripe secret is a worse
 *     trade than the problem it solves.
 *   * a `livemode` field on some previously-created object tells you the mode as
 *     of the LAST charge, not the current configuration — precisely the stale
 *     reading that would let a freshly flipped key through.
 * The session id is produced by the key that is live RIGHT NOW, arrives in the
 * response the app already returns, and needs no secret at all. Creating a
 * Checkout Session charges nothing — the card is only taken when the hosted page
 * is submitted — so this reads the environment at the last safe moment before
 * the only irreversible step.
 */
function stripeModeFromCheckoutUrl(url: string): "test" | "live" | "unknown" {
  const m = /\/(cs_(test|live)_[A-Za-z0-9]+)/.exec(url);
  if (!m) return "unknown";
  return m[2] === "live" ? "live" : "test";
}

/** Announce a degraded leg where CI actually shows it, not only in the log. */
function announceUncovered(title: string, detail: string) {
  // GitHub picks workflow commands out of any step's stdout.
  console.log(`::warning title=${title}::${detail}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `- **${title}.** ${detail}\n`);
    } catch {
      // A summary file we cannot write is not a reason to fail the run; the
      // ::warning:: above still lands.
    }
  }
}

type Session = { access_token: string; user: { id: string } };

async function signIn(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(r.ok(), `sign-in failed for ${email}: ${r.status()} ${await r.text()}`).toBe(true);
  const body = (await r.json()) as Session;
  expect(body.access_token, "GoTrue returned no access token").toBeTruthy();
  return body;
}

function rest(session: Session) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

/** Read a job's current row as the poster. */
async function readJob(api: APIRequestContext, session: Session, jobId: string) {
  const r = await api.get(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&select=id,status,payment_status,helper_id,parish,is_seed,poster_completed_at,helper_completed_at,payout_scheduled_at`,
    { headers: rest(session) },
  );
  expect(r.ok(), `reading job ${jobId}: ${r.status()}`).toBe(true);
  const rows = await r.json();
  expect(rows, `job ${jobId} vanished`).toHaveLength(1);
  return rows[0];
}

/**
 * Drive ONE proof photo through the app's own uploader, as the helper, in a
 * real browser — the picker, the dialog, the Upload button, and the
 * `supabase.storage.from("proof-photos").upload()` call behind it.
 *
 * WHY THIS IS NOT A REST PATCH. It used to be: the spec wrote two
 * `https://example.invalid/…` strings into `proof_before_urls` and said so in a
 * comment, because everything else here is a REST walk of the money state
 * machine. That left the single most failure-prone step in the completion
 * gate — an upload into a bucket whose RLS has broken at least twice — with no
 * unmocked coverage at all, while the run went green. The 2026-08-26 incident
 * is the shape of what that hides: every file failed to upload, the dialog
 * closed reporting success, and the job carried no proof. The URLs the gate
 * checks are only worth something if an object is behind them.
 *
 * @returns the object path inside the bucket, e.g. `<jobId>/before-….png`.
 */
async function uploadProofThroughTheApp(
  page: Page,
  helper: Session,
  jobId: string,
  runId: string,
  type: "before" | "after",
  fileDir: string,
  /* Only the FIRST ask navigates. The second stays on the page it is on and
     waits for the card to advance on its own, which is exactly what a helper
     sees: upload the after photo, and the before ask replaces it.
     Navigating again was worse than redundant. On 2026-09-12 the after photo
     uploaded 18 seconds into the run, and the follow-up `page.goto("/")` then
     sat for 296 seconds until the test budget expired with net::ERR_ABORTED.
     The trace shows the document request for "/" cancelled (status -1) in the
     same instant the page refetched its My Jobs data after the upload. A hard
     navigation racing the page's own post-upload update is a test artefact,
     not a user path; staying put removes the race and asserts the behaviour
     that matters instead. */
  navigate = true,
): Promise<string> {
  const label = type === "before" ? "Before" : "After";
  const file = join(fileDir, `${type}.png`);
  writeFileSync(file, PROOF_PNG);

  // Seed the session on a page that is already on the origin (localStorage is
  // origin-scoped, so this cannot be done before the first navigation), then
  // deep-link. `?job=` is the app's own highlight link — the same one every
  // notification uses — so the card is brought into view by product code
  // rather than by scrolling a list the test would have to guess the shape of.
  if (navigate) {
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [AUTH_STORAGE_KEY, JSON.stringify(helper)] as const,
    );
    await page.goto(`/my-jobs?job=${jobId}`);
  }

  // Scoped by the run id, which is unique per run and is part of the job
  // title. A previous run that died mid-loop can leave a SECOND in-progress
  // job on this same account carrying the same marker, and an unscoped
  // "Add Photo" button would then be a coin flip between them.
  const card = page.locator("div.liquid-glass").filter({ hasText: runId }).first();
  await expect(
    card,
    `the helper's /my-jobs never rendered the card for run ${runId} — the job is ${jobId}`,
  ).toBeVisible({ timeout: 60_000 });

  // ONE PHOTO ASK AT A TIME, TIED TO THE TRACKER STEP (owner, 2026-09-11,
  // HelperPhotoAsk.tsx). The card no longer carries a "Before Photos" /
  // "After Photos" pair: it renders a single panel titled "Add a before photo"
  // or "Add an after photo" whose button reads "Add Photo". This locator used
  // to wait for `^Before Photos$`, which stopped existing when that redesign
  // reached production — the money loop then sat on a fully funded, hired,
  // in-progress job for the whole five-minute test budget, and failed in a way
  // that read like a flake rather than a selector that had gone stale.
  //
  // The heading is asserted FIRST so the single "Add Photo" button is known to
  // belong to the right type; the dialog title check below confirms it again.
  const askHeading = type === "before" ? "Add a before photo" : "Add an after photo";
  await expect(
    card.getByText(askHeading, { exact: true }),
    `the card never asked for the ${type} photo — the app shows one ask per tracker step, so check the order`,
  ).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: /^Add Photo$/ }).click();

  // The dialog is portaled to <body>, so it is NOT inside `card`.
  const dialog = page.getByRole("dialog").filter({ hasText: `${label} photos` });
  await expect(dialog).toBeVisible();
  // The input is `hidden` behind its label, which is exactly what setInputFiles
  // is for — it sets the files directly and fires `change`, the same event the
  // OS picker produces.
  await dialog.locator('input[type="file"]').setInputFiles(file);

  // Captured rather than derived: the path is minted inside the component
  // (`${jobId}/${type}-${Date.now()}-${random}.${ext}`) and there is no other
  // way to learn it exactly. It also proves the upload was a real POST to the
  // real storage API, and that it went into THIS job's folder — the check that
  // catches a mis-clicked card.
  const uploadResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/storage/v1/object/proof-photos/"),
    { timeout: 60_000 },
  );
  await dialog.getByRole("button", { name: "Upload" }).click();
  const response = await uploadResponse;
  expect(
    response.status(),
    `storage rejected the ${type} photo: ${response.status()} ${await response.text()}`,
  ).toBe(200);
  const { Key } = (await response.json()) as { Key: string };
  expect(Key, "storage returned no object key").toBeTruthy();
  const path = Key.replace(/^proof-photos\//, "");
  expect(path, "the photo was uploaded outside this job's folder").toMatch(
    new RegExp(`^${jobId}/${type}-`),
  );
  uploadedProofPaths.push(path);

  // The dialog only closes on the success path — `upload()` returns early and
  // keeps it open when nothing landed or the jobs UPDATE matched zero rows. So
  // this assertion is the app's own verdict, not a cosmetic wait.
  await expect(
    dialog,
    `the ${type}-photo dialog stayed open, so the app did not consider the upload saved`,
  ).toBeHidden({ timeout: 30_000 });

  return path;
}

test.describe("full money loop against production", () => {
  test.skip(
    !READY,
    "Set PLAYWRIGHT_POSTER_EMAIL / PLAYWRIGHT_POSTER_PASSWORD and PLAYWRIGHT_HELPER_EMAIL / " +
      "PLAYWRIGHT_HELPER_PASSWORD. Until then the escrow, hire, complete, release and review " +
      "legs have NO unmocked coverage — see e2e-real-backend.yml's boundary report.",
  );

  /* Storage teardown. The job row itself is unremovable once it is funded —
     that residue is documented at the top of this file and is the price of
     testing against prod — but the OBJECTS are removable by the helper who
     uploaded them (`Users can delete their own proof photos`, via
     `is_party_to_job_folder`), and one settled job per night carrying two
     orphan images is growth nothing would ever come back for.

     Runs on failure too, which is the case that matters: a run that dies after
     the upload but before completion is exactly the run that leaves them.
     The signed URLs left on the row will 400 afterwards; that is deliberate and
     preferable to unbounded bucket growth, and the row is already a tombstone.
     Deliberately non-fatal — a teardown that fails the suite turns a tidy-up
     problem into a false report about the money loop. */
  test.afterEach(async ({ request }) => {
    if (!READY || uploadedProofPaths.length === 0) return;
    const paths = uploadedProofPaths.splice(0, uploadedProofPaths.length);
    try {
      const helper = await signIn(request, HELPER_EMAIL!, HELPER_PASSWORD!);
      const removed = await request.delete(`${SUPABASE_URL}/storage/v1/object/proof-photos`, {
        headers: rest(helper),
        data: { prefixes: paths },
      });
      if (!removed.ok()) {
        announceUncovered(
          "Proof photos not cleaned up",
          `storage remove returned ${removed.status()} — ${paths.length} object(s) left in \`proof-photos\`: ${paths.join(", ")}`,
        );
      }
    } catch (err) {
      announceUncovered(
        "Proof photos not cleaned up",
        `teardown threw (${String(err)}) — ${paths.length} object(s) left in \`proof-photos\`: ${paths.join(", ")}`,
      );
    }
  });

  // One test, not seven. The legs are not independent: each needs the state the
  // previous one produced, and splitting them into separate tests would either
  // re-run the whole loop per leg (four funded jobs per push) or leak state
  // between tests through prod. A single linear test is the honest shape.
  test("post, fund, apply, hire, complete, release, review", async ({ page, request }) => {
    test.setTimeout(5 * 60_000);

    const poster = await signIn(request, POSTER_EMAIL!, POSTER_PASSWORD!);
    const helper = await signIn(request, HELPER_EMAIL!, HELPER_PASSWORD!);
    expect(poster.user.id, "poster and helper resolved to the same account").not.toBe(helper.user.id);

    // --- 1. POST ------------------------------------------------------------
    // Created over REST rather than through the post-job form, deliberately.
    // The form derives `parish` from the ZIP, and a null parish IS the
    // blast-radius control that works — a UI-posted job would notify real
    // helpers. `is_seed` is sent for intent only; the column lock will force
    // it false and control 3 above explains why that is correct. The form's
    // own coverage lives in the mocked happy-path suite
    // (customer-post-job.spec.ts); what is unmocked here is everything
    // downstream of the row existing.
    const runId = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? "local"}`;
    const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: {
        customer_id: poster.user.id,
        title: `${E2E_TITLE_MARKER} automated lifecycle ${runId}`,
        description:
          "Automated end-to-end test row. Not a real job. Created and settled by CI; " +
          "if you are reading this in the app, something has gone wrong with the test harness.",
        category: "cleaning",
        budget: 25,
        location: "Baton Rouge, LA",
        date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
        // The two blast-radius fields. Asserted below, because a silently
        // dropped column here is the difference between a quiet test row and
        // one that emails strangers.
        parish: null,
        is_seed: true,
      },
    });
    expect(created.ok(), `job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
    const [job] = await created.json();
    expect(job.id, "insert returned no row").toBeTruthy();

    // These are not decoration. If `parish` came back non-null the fan-out
    // trigger is live for this row, and the run must stop before funding it —
    // funding is what arms the notification.
    expect(job.parish, "parish must be null or the helper fan-out fires").toBeNull();
    // NOT a hardcoded literal, in either direction. `is_seed` was sent above
    // "for intent" and the column lock discards it — that has never changed and
    // is the control being asserted. What changed (20260908015405) is the
    // ANSWER: the lock now derives the flag from the posting account rather
    // than hardcoding false. So the value that lands must equal this poster's
    // own `profiles.is_seed`, whatever that is — which is what makes this
    // assertion still fail if someone ever lets the client win.
    const posterProfile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${poster.user.id}&select=is_seed`,
      { headers: rest(poster) },
    );
    expect(
      posterProfile.ok(),
      `poster profile read failed: ${posterProfile.status()} ${await posterProfile.text()}`,
    ).toBe(true);
    const [posterRow] = await posterProfile.json();
    expect(posterRow, "poster has no profiles row").toBeTruthy();
    expect(
      job.is_seed,
      "jobs.is_seed must come from the posting ACCOUNT, never from the client payload — " +
        "the column lock ignored the is_seed:true sent above and derived this from profiles.is_seed",
    ).toBe(posterRow.is_seed);
    // Both CI accounts are @mailinator.com, so this should be a seed account.
    // Asserted separately from the equality above so a red run says WHICH half
    // broke: the derivation, or the fixture accounts losing their flag.
    expect(
      posterRow.is_seed,
      "the CI poster is a @mailinator.com fixture account and must be flagged is_seed",
    ).toBe(true);
    announceUncovered(
      "Seven money sweeps still see the test job",
      "The five sweeps that filter on `is_seed` now skip this run's job, because the flag is derived " +
        "from the @mailinator.com poster account. The other seven ignore the flag and still see it. " +
        "Bounded by the null parish, the browse embargo, the title marker and the sweeper that runs " +
        "before and after. Note the flip side: auto-release-payment now skips this job too, so the " +
        "direct release-payout call below is load-bearing, not a shortcut.",
    );

    // --- 2. FUND (real Stripe Checkout) -------------------------------------
    const escrow = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
      headers: rest(poster),
      data: { action: "escrow", jobId: job.id },
    });
    expect(escrow.ok(), `create-payment escrow failed: ${escrow.status()} ${await escrow.text()}`).toBe(true);
    const { url: checkoutUrl } = await escrow.json();
    expect(checkoutUrl, "create-payment returned no checkout url").toBeTruthy();
    expect(String(checkoutUrl)).toContain("checkout.stripe.com");

    const mode = stripeModeFromCheckoutUrl(String(checkoutUrl));
    // "unknown" is treated as live. A URL shape we cannot read is not evidence
    // of safety, and the failure mode of guessing wrong is a real charge.
    const cardIsSafe = mode === "test";

    if (!cardIsSafe) {
      announceUncovered(
        "Funding leg SKIPPED — Stripe is in LIVE mode",
        `create-payment returned a ${mode === "live" ? "cs_live_" : "unrecognised"} Checkout Session, so the ` +
          `funding leg cannot run without charging a real card — Stripe rejects test card 4242 in live mode, ` +
          `and there is no card this suite can safely submit. Escrow funding, payout release and review are ` +
          `therefore UNCOVERED on this run. The fix is a second Stripe account dedicated to tests, not a real ` +
          `card here. Post, apply, hire and complete still ran.`,
      );
      test.info().annotations.push({
        type: "uncovered",
        description: "Stripe LIVE mode — funding, release and review skipped",
      });
      // Unwind the session we created. It was never submitted, so nothing was
      // charged and nothing will be; this just stops the row sitting around
      // with a stripe_session_id for the next sweep to reason about.
      await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "cancel_escrow", jobId: job.id },
      });
    } else {
      await page.goto(String(checkoutUrl), { waitUntil: "domcontentloaded" });

      /* Stripe's hosted page, driven the way it actually behaves. The previous
         version reached for `getByPlaceholder("1234 1234 1234 1234")` and hung
         until the 5-minute test timeout — the first thing this suite has ever
         done past the is_seed assertion, and it could not have worked:

           * Card is one option in a payment-method ACCORDION (Card / Affirm /
             US bank account / Cash App), and it starts COLLAPSED, so no card
             input exists in the DOM to match a placeholder against. Opening it
             by clicking the text "Card" does not work either — Stripe's own
             `card-accordion-item-button` sits on top and swallows the click.
             Clicking the first radio, forced, is what opens it.
           * Once open the fields carry stable ids, so use those rather than
             placeholder text that is localised and has changed before.
           * "Save my information" (`#enableStripePass`) is checked by default
             and makes Link demand a phone number; leave it on and the Pay
             button silently refuses to submit. It must be unchecked.

         Each of these was found by driving the real hosted page — see the shots
         under docs/audit/launch-2026-09/lanes/e2e/. */
      // The accordion only exists when Stripe offers MORE than one method; with
      // a single method the card fields are already open and there is no
      // radio at all — run 34169858494 sat on `getByRole("radio")` for the
      // whole 5-minute budget on exactly that page. Wait for whichever
      // appears first, click the radio only if it did.
      const cardNumber = page.locator("#cardNumber");
      const methodRadio = page.getByRole("radio").first();
      await expect(cardNumber.or(methodRadio)).toBeVisible({ timeout: 60_000 });
      if (!(await cardNumber.isVisible().catch(() => false))) {
        await methodRadio.click({ force: true });
      }
      await cardNumber.waitFor({ state: "visible", timeout: 30_000 });
      await page.locator("#cardNumber").fill(TEST_CARD.number);
      await page.locator("#cardExpiry").fill(TEST_CARD.expiry);
      await page.locator("#cardCvc").fill(TEST_CARD.cvc);
      /* Fill EVERY billing field Stripe renders, not just name and postcode.
         Which ones appear depends on the account's address-collection setting,
         and a blank required one makes Pay a no-op with an inline message the
         test never sees. Line 1 also triggers a Google autocomplete dropdown
         that covers the fields below it, so dismiss it before moving on. */
      for (const [id, value] of [
        ["#billingName", TEST_CARD.name],
        ["#billingAddressLine1", TEST_CARD.line1],
        ["#billingLocality", TEST_CARD.city],
        ["#billingPostalCode", TEST_CARD.zip],
      ] as const) {
        const field = page.locator(id);
        if ((await field.count()) && (await field.isVisible().catch(() => false))) {
          await field.fill(value).catch(() => {});
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
      const linkOptIn = page.locator("#enableStripePass");
      if ((await linkOptIn.count()) && (await linkOptIn.isChecked().catch(() => false))) {
        await linkOptIn.uncheck({ force: true }).catch(() => {});
      }
      await page.getByTestId("hosted-payment-submit-button").click();

      /* If Pay does not take, say WHY. Without this the only symptom is a
         120s navigation timeout, which names the wait rather than the cause —
         and the cause is on the page, in an inline validation message, every
         time. Costs nothing on the happy path: the URL has already changed by
         the time this runs, so the branch is skipped. */
      await page.waitForTimeout(6_000);
      if (!/\/payment-success/.test(page.url())) {
        const complaints = await page
          .locator('[role="alert"], .FieldError, [class*="Error"]')
          .allInnerTexts()
          .catch(() => [] as string[]);
        const unique = [...new Set(complaints.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
        console.log(
          `::warning title=Stripe Checkout did not submit::still on ${page.url().slice(0, 120)} — ` +
            (unique.length ? `page says: ${unique.join(" | ")}` : "no inline error text found on the page"),
        );
      }
      /* Wait to LEAVE Stripe — deliberately not for /payment-success.
         This suite authenticates over REST; `page` is a plain browser context
         with no app session in it. So when Stripe returns to the prod origin,
         ProtectedRoute often bounces straight to
         /login?redirect=%2Fpayment-success, and asserting the success path made
         the run fail roughly half the time on a race between first paint and
         the auth check — green on a retry, red on the attempt, which is worse
         than either. Signing the browser in as well would be testing our own
         harness; the landing screen is a UI concern and belongs in a UI spec.

         What this leg is actually here to prove is that the CHARGE went
         through, and the authority on that is the webhook moving payment_status
         to 'escrow' — polled immediately below. Leaving checkout.stripe.com is
         the correct, session-independent signal that the card was submitted. */
      await page.waitForURL((url) => !url.host.endsWith("checkout.stripe.com"), {
        timeout: 120_000,
      });

      // The webhook, not the redirect, is what moves the row. Poll for it — a
      // redirect that lands before `checkout.session.completed` is delivered is
      // normal, and asserting immediately would make this flaky in a way that
      // looks like a product bug.
      await expect
        .poll(async () => (await readJob(request, poster, job.id)).payment_status, {
          timeout: 60_000,
          message: "stripe-webhook never moved payment_status to escrow",
        })
        .toBe("escrow");
    }

    /* CLEAR THE EARLY-ACCESS EMBARGO BEFORE APPLYING.
       `apply_to_job` refuses a free-tier helper with 403 job_in_early_access_window
       ("This job is in its Early Access window. Pro and Elite members can apply
       first") until `created_at <= early_access_cutoff()`. That cutoff is
       `now() - 20 minutes` for a free account, and both test accounts are free —
       so a job posted seconds ago is un-appliable by design, and this leg failed
       on it the first time funding ever succeeded. Waiting 20 minutes per run is
       not an option, so the row is aged instead.

       `created_at` is not in enforce_poster_jobs_money_lock's locked_always, so
       the poster may set it; the PATCH is asserted rather than assumed, because a
       silently-refused write here would resurface as a confusing 403 two steps
       later rather than as a failure here. This is a TEST-HARNESS concession to a
       real product rule — the embargo itself is deliberate and is not being
       worked around in the app. */
    const aged = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
    });
    expect(aged.ok(), `ageing the job past early access failed: ${aged.status()} ${await aged.text()}`).toBe(true);
    expect(await aged.json(), "ageing the job matched zero rows — the poster could not set created_at").toHaveLength(1);

    // --- 3. APPLY -----------------------------------------------------------
    const applied = await request.post(`${SUPABASE_URL}/rest/v1/applications`, {
      headers: { ...rest(helper), Prefer: "return=representation" },
      data: {
        job_id: job.id,
        helper_id: helper.user.id,
        message: `${E2E_TITLE_MARKER} automated application`,
      },
    });
    expect(applied.ok(), `application insert failed: ${applied.status()} ${await applied.text()}`).toBe(true);
    const [application] = await applied.json();
    expect(application.id).toBeTruthy();

    /* --- 4. HIRE -----------------------------------------------------------
       THROUGH `accept_application`, the RPC the product's own accept button
       calls (useOfferHandlers.ts:229). This used to be a direct PATCH of
       `jobs.helper_id` + `status`, which produces two of the three writes a
       real hire makes and silently skips the third: the APPLICATION stays
       `pending`. Nothing downstream in this REST walk reads it, so the loop
       went green on a job that the product does not consider hired — and the
       helper's own card proved it, rendering the pending-application branch
       instead of the in-progress one, because `isActive` is
       `app.status === "accepted" && job.status === "in_progress"`
       (appliedJobCardHelpers.ts:48). The proof-photo uploader lives inside
       that branch, so the first attempt to drive it found no button.

       The RPC locks the job row, authorises the caller as the poster, refuses
       a job that is not still open and an application that is not still
       pending, and then makes all three writes together. A test that hires by
       hand is a test that cannot see a hire path breaking. */
    const hired = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_application`, {
      headers: rest(poster),
      data: {
        p_application_id: application.id,
        // The offer's response deadline. 48h is what the product's dialog
        // defaults to; nothing in this loop waits on it.
        p_deadline: new Date(Date.now() + 48 * 3600_000).toISOString(),
      },
    });
    expect(hired.ok(), `accept_application failed: ${hired.status()} ${await hired.text()}`).toBe(true);

    // The RPC returns void, so the writes are asserted by reading them back —
    // both of them, because a hire that moves the job but not the application
    // is exactly the half-hire this step used to produce.
    const acceptedApp = await request.get(
      `${SUPABASE_URL}/rest/v1/applications?id=eq.${application.id}&select=status`,
      { headers: rest(helper) },
    );
    expect(acceptedApp.ok(), `reading the application back failed: ${acceptedApp.status()}`).toBe(true);
    expect(
      ((await acceptedApp.json()) as Array<{ status: string }>)[0]?.status,
      "the application is not 'accepted' — the helper's card will render the pending branch",
    ).toBe("accepted");

    const afterHire = await readJob(request, poster, job.id);
    expect(afterHire.helper_id).toBe(helper.user.id);

    /* --- 4b. ARRIVAL — the gate completion actually depends on --------------
       `enforce_helper_completion_gates` rejects a completion with 400
       completion_requires_confirmed_arrival ("Mark arrival at the job site, or
       ask the poster to confirm you arrived") unless arrival is on the row. The
       spec used to jump from hire straight to helper_completed_at and failed
       there the first time it ever got that far.

       These are not filler to satisfy a trigger — they are three real legs of
       the journey (on-my-way, arrived, poster confirms arrival) that had no
       coverage at all, and driving them manually is how the gate was found.
       The poster's confirmation is the branch that matters most: it is the
       fallback the product offers when the helper's device gives no location,
       which is exactly what a headless browser does. */
    const onTheWay = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(helper), Prefer: "return=representation" },
      /* Backdated, not "now". Completion is additionally gated on 30 minutes
         having passed since arrival ("Available 30 minutes after arrival to
         ensure quality"), so a run that stamped arrival at the current instant
         would satisfy the arrival trigger and then fail the delay one. These
         two timestamps are the only place the suite pretends time passed. */
      data: { helper_on_the_way_at: new Date(Date.now() - 45 * 60_000).toISOString(), status: "in_progress" },
    });
    expect(onTheWay.ok(), `on-my-way failed: ${onTheWay.status()} ${await onTheWay.text()}`).toBe(true);
    expect(await onTheWay.json(), "on-my-way matched zero rows").toHaveLength(1);

    const arrived = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(helper), Prefer: "return=representation" },
      data: { helper_arrived_at: new Date(Date.now() - 35 * 60_000).toISOString() },
    });
    expect(arrived.ok(), `arrival failed: ${arrived.status()} ${await arrived.text()}`).toBe(true);
    expect(await arrived.json(), "arrival matched zero rows").toHaveLength(1);

    const arrivalConfirmed = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(poster), Prefer: "return=representation" },
      data: { poster_confirmed_arrival_at: new Date(Date.now() - 30 * 60_000).toISOString() },
    });
    expect(
      arrivalConfirmed.ok(),
      `poster arrival confirmation failed: ${arrivalConfirmed.status()} ${await arrivalConfirmed.text()}`,
    ).toBe(true);
    expect(await arrivalConfirmed.json(), "arrival confirmation matched zero rows").toHaveLength(1);

    /* --- 4c. PROOF PHOTOS — the other completion gate ----------------------
       `enforce_helper_completion_gates` also refuses completion with
       23514 completion_requires_proof_photos ("Add before and after photos
       before marking the job done"). The photos are not decoration: the app
       tells the helper they are "the proof that releases your payment".

       UPLOADED, not asserted as strings. This step used to PATCH two
       `https://example.invalid/…` URLs straight onto the row, and said in this
       comment that the upload itself was "a UI concern driven by hand". That
       was the last mock left inside the unmocked loop: the gate went green on
       two strings, so a `proof-photos` bucket that refused every write — which
       is what happened on 2026-08-26, and again when its RLS was fixed on
       2026-08-31 — could not have failed this run. Both photos now travel
       through the helper's own browser: the picker, the dialog, the Upload
       button, `supabase.storage.upload()` and the jobs UPDATE that follows it.
       Before AND after, because `hasRequiredProof` demands both and there is no
       reason to prove one path and stub the other. */
    const proofDir = mkdtempSync(join(tmpdir(), "lh-proof-"));
    // AFTER FIRST, then before — the order the app asks in. With arrival
    // confirmed the card is on the Working step, and HelperPhotoAsk puts the
    // After ask first there (a finished-work photo is the step's own ask; a
    // still-missing Before only appears once the After exists). Uploading
    // Before first waits for a panel the app will not render yet.
    const afterPath = await uploadProofThroughTheApp(page, helper, job.id, runId, "after", proofDir);
    // No navigation: the card must move to the before ask by itself.
    const beforePath = await uploadProofThroughTheApp(page, helper, job.id, runId, "before", proofDir, false);

    /* THE OBJECT EXISTS — asked of storage, not of the app that just claimed
       it. Listed as the HELPER (the `Users can read proof photos for their
       jobs` policy admits them via `is_party_to_job_folder`), which
       additionally proves the uploader can see back what they uploaded. A
       service-role read would be a stronger oracle and is deliberately not
       available to CI here; the helper's own token is the next best thing and
       is not the client under test — that is the app running in the browser. */
    const listed = await request.post(`${SUPABASE_URL}/storage/v1/object/list/proof-photos`, {
      headers: rest(helper),
      data: { prefix: `${job.id}/`, limit: 100 },
    });
    expect(listed.ok(), `listing proof-photos failed: ${listed.status()} ${await listed.text()}`).toBe(true);
    const objectNames = ((await listed.json()) as Array<{ name: string }>).map((o) => `${job.id}/${o.name}`);
    expect(objectNames, "the before photo is not in the bucket").toContain(beforePath);
    expect(objectNames, "the after photo is not in the bucket").toContain(afterPath);

    /* AND THE ROW POINTS AT THOSE OBJECTS. Two separate failures live here and
       only this assertion separates them: an upload that lands but is never
       attached (the zero-row UPDATE the component's `.select("id")` guards),
       and a row carrying a URL for an object that is not there. */
    const withProof = await request.get(
      `${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=proof_before_urls,proof_after_urls`,
      { headers: rest(helper) },
    );
    expect(withProof.ok(), `reading proof urls failed: ${withProof.status()}`).toBe(true);
    const [proofRow] = (await withProof.json()) as Array<{
      proof_before_urls: string[] | null;
      proof_after_urls: string[] | null;
    }>;
    expect(proofRow.proof_before_urls ?? [], "no before-photo url on the job").toHaveLength(1);
    expect(proofRow.proof_after_urls ?? [], "no after-photo url on the job").toHaveLength(1);
    const beforeUrl = (proofRow.proof_before_urls ?? [])[0];
    const afterUrl = (proofRow.proof_after_urls ?? [])[0];
    expect(beforeUrl, "the before url does not address the uploaded object").toContain(beforePath);
    expect(afterUrl, "the after url does not address the uploaded object").toContain(afterPath);

    /* The link the poster and the dispute timeline actually render. A signed
       URL is fetched WITHOUT credentials on purpose — that is how an <img> tag
       fetches it — and the byte length is compared to what was uploaded, so a
       0-byte object or an error page rendered as an image cannot pass. */
    for (const [name, url] of [["before", beforeUrl], ["after", afterUrl]] as const) {
      const fetched = await request.get(url);
      expect(fetched.ok(), `the ${name} photo's signed url returned ${fetched.status()}`).toBe(true);
      expect(
        (await fetched.body()).length,
        `the ${name} photo came back a different size than was uploaded`,
      ).toBe(PROOF_PNG.length);
    }

    /* --- 5. COMPLETE (helper side) -----------------------------------------
       Only the helper completes over REST. The poster CANNOT: `poster_completed_at`
       is in enforce_poster_jobs_money_lock's `locked_when_funded`, so a direct
       PATCH is refused with

           403 "Posters may not modify jobs.poster_completed_at once checkout has opened"

       and this spec used to try exactly that. The lock is right — the poster
       confirming completion is the moment money moves, so it belongs to the
       server. In the product that confirmation IS the release: `create-payment`
       with action "release" stamps poster_completed_at for a poster caller and,
       once both sides are done, captures and schedules the payout in the same
       call (create-payment/index.ts:576). So the poster's completion is not
       missing from this suite, it is step 6. */
    const helperDone = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}`, {
      headers: { ...rest(helper), Prefer: "return=representation" },
      data: { helper_completed_at: new Date().toISOString() },
    });
    expect(helperDone.ok(), `helper completion failed: ${helperDone.status()} ${await helperDone.text()}`).toBe(true);
    expect(await helperDone.json(), "helper completion matched zero rows").toHaveLength(1);

    // --- 6 & 7. RELEASE and REVIEW ------------------------------------------
    // Both are downstream of funding, and the dependency is not stylistic: the
    // `Users can create reviews for eligible jobs` policy requires
    // `j.payment_status = ANY (ARRAY['released','payout_pending'])`, so an
    // unfunded job cannot be reviewed no matter what else is true of it. That is
    // exactly where the degradation line falls, and it is a property of the
    // database rather than a choice made here.
    if (cardIsSafe) {
      const released = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
        headers: rest(poster),
        data: { action: "release", jobId: job.id },
      });
      expect(released.ok(), `release failed: ${released.status()} ${await released.text()}`).toBe(true);

      await expect
        .poll(async () => (await readJob(request, poster, job.id)).payment_status, {
          timeout: 60_000,
          message: "payment_status never reached a settled state after release",
        })
        .toMatch(/^(payout_pending|released)$/);

      // The release call is also the poster's completion — assert it landed,
      // since that is the half a direct PATCH is (correctly) forbidden to do.
      const settled = await readJob(request, poster, job.id);
      expect(settled.poster_completed_at, "release did not stamp poster_completed_at").toBeTruthy();

      /* What release actually produces, checked against what it actually does.
         This used to assert a `payout_transfers` row existed and failed on it
         ("release produced no payout_transfers row") the first time the suite
         ever got this far. Release does not pay anybody: it captures, sets
         payout_scheduled_at and moves payment_status to 'payout_pending'
         (create-payment/index.ts:604-606). The transfer row is written later by
         process-scheduled-payouts, when the payout is genuinely sent — so
         demanding one here was asserting the wrong function's work, and would
         have gone red forever while the product behaved correctly.

         The ledger row is covered by step 6b below, which drives the payout
         path release hands the job to. */
      expect(settled.payout_scheduled_at, "release did not schedule a payout").toBeTruthy();

      /* --- 6b. PAYOUT — the money actually leaving the platform -------------
         The leg that was uncovered until 2026-09-07, and the only one that
         proves a helper is ever paid. Everything above it can be true of a job
         whose money never moves.

         WHY `release-payout` AND NOT `process-scheduled-payouts`.
         The cron is the scheduled path, and it cannot be driven from a test:
         it selects `payout_scheduled_at <= now()`, and release sets that to
         now + 24h (create-payment/index.ts:602). Nothing a test may write can
         pull it forward — `payout_scheduled_at` sits in
         prevent_job_field_escalation's `locked_everyone`, so it is refused for
         every authenticated caller including the poster who owns the job. The
         two ways to make the cron see the job are to wait a day or to hold
         service-role, and this suite does neither.

         `release-payout` is the same money movement without the clock: it is
         the function the admin "Release payout" button calls and the one
         auto-release-payment's Phase 2 invokes over HTTP, and it is the only
         function in the repo that calls `stripe.transfers.create` for a single
         helper. Its preconditions are exactly the state release just produced
         (status 'completed', payment_status 'payout_pending', a helper with a
         Connect account) — no time gate. So this is a real production path
         driven the way production drives it, not a test-only shortcut.

         WHY AN ADMIN ACCOUNT AND NOT THE CRON SECRET. The function's other
         door is a bearer equal to CRON_SECRET or the service-role key, which
         looks like the smaller ask because it is not a login. It is the larger
         one. CRON_SECRET authorises 29 edge functions here — void-cancelled-
         payments, auto-resolve-disputes, money-reconciliation, every payout
         path — so CI holding it is wider custody than the service-role key the
         sweep step already refuses on exactly this reasoning. It is also
         anonymous: `initiated_by_user_id` is stamped only on the admin branch
         (release-payout/index.ts:98), so a secret-driven payout is recorded in
         the ledger with a null actor forever. The admin account is narrower,
         independently revocable, and leaves its name on the row.

         WHY THE TRANSFER ID IS THE PROOF. `tr_…` ids are minted by Stripe and
         by nothing else — no trigger, no default and no client write can
         produce one — so a ledger row carrying one is evidence the transfer
         happened, not evidence the app believes it did. The row is read as the
         HELPER: `payout_transfers` is readable only by its own helper or an
         admin, so the poster session (which does everything else here) cannot
         see it, and reading it as the helper additionally proves the payee can
         see their own payment. */
      if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        announceUncovered(
          "Payout leg not covered",
          "`PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD` are not set, so `release-payout` was " +
            "not driven. Escrow funding, hire, completion and release ARE covered by this run, but " +
            "**nothing proves money reached the helper's Stripe Connect account** — no transfer was " +
            "sent and no `payout_transfers` row was written. Set them to a dedicated account holding " +
            "the `admin` role. Do NOT substitute `CRON_SECRET`: it authorises every money function in " +
            "the system and records no actor.",
        );
      } else {
        const admin = await signIn(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        const payout = await request.post(`${SUPABASE_URL}/functions/v1/release-payout`, {
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${admin.access_token}`,
            "Content-Type": "application/json",
          },
          // `initiated_by` is deliberately NOT sent: release-payout only honours
          // it on the cron branch, and on this one it stamps 'admin' plus the
          // acting user id itself. Sending it would be ignored and would read
          // as though it were not.
          data: { job_id: job.id },
        });
        const payoutBody = await payout.text();
        // A 401 here means the account CI holds no longer carries the admin
        // role, or the function's auth changed. That is a real finding about
        // the deployment, not a flaky test, so it fails rather than degrading —
        // a payout path nobody can invoke is worth knowing about.
        expect(payout.ok(), `release-payout failed: ${payout.status()} ${payoutBody}`).toBe(true);
        const payoutJson = JSON.parse(payoutBody) as {
          stripe_transfer_id?: string;
          amount_cents?: number;
        };
        expect(payoutJson.stripe_transfer_id, "release-payout returned no Stripe transfer id").toMatch(
          /^tr_/,
        );
        expect(payoutJson.amount_cents ?? 0, "release-payout transferred nothing").toBeGreaterThan(0);

        // The ledger, read by the payee. Polled because the transfer and the
        // claim settle in separate writes.
        await expect
          .poll(
            async () => {
              const r = await request.get(
                `${SUPABASE_URL}/rest/v1/payout_transfers` +
                  `?job_id=eq.${job.id}&select=stripe_transfer_id,status,helper_id`,
                { headers: rest(helper) },
              );
              if (!r.ok()) return `read failed: ${r.status()}`;
              const rows = (await r.json()) as Array<{
                stripe_transfer_id: string | null;
                status: string;
              }>;
              if (rows.length !== 1) return `${rows.length} ledger rows`;
              return `${rows[0].status}:${rows[0].stripe_transfer_id ?? "no-transfer-id"}`;
            },
            {
              timeout: 60_000,
              message:
                "no settled payout_transfers row visible to the helper after release-payout returned a transfer id",
            },
          )
          .toBe(`paid:${payoutJson.stripe_transfer_id}`);

        // And the job's own money state reaches its terminal value. This is the
        // flip release-payout does AFTER the transfer, so asserting it is what
        // distinguishes "money moved" from "money moved and the ledger says so"
        // — the split that produces a paid helper on a job that still reads
        // payout_pending, which is the exact state money-reconciliation:287
        // exists to page about.
        await expect
          .poll(async () => (await readJob(request, poster, job.id)).payment_status, {
            timeout: 30_000,
            message: "payment_status never reached 'released' after the payout was sent",
          })
          .toBe("released");
      }

      const review = await request.post(`${SUPABASE_URL}/rest/v1/reviews`, {
        headers: { ...rest(poster), Prefer: "return=representation" },
        data: {
          job_id: job.id,
          reviewer_id: poster.user.id,
          reviewee_id: helper.user.id,
          rating: 5,
          // `feedback`, not `comment` — the column is called feedback in prod
          // (checked against information_schema, not guessed from the client).
          feedback: `${E2E_TITLE_MARKER} automated review`,
        },
      });
      expect(review.ok(), `review insert failed: ${review.status()} ${await review.text()}`).toBe(true);
      expect(await review.json(), "review insert matched zero rows").toHaveLength(1);
    }

    // --- 8. The blast-radius claims, re-asserted after the fact --------------
    // Stated as assertions rather than trusted from step 1, because a trigger
    // or a later PATCH could have changed them mid-loop.
    const final = await readJob(request, poster, job.id);
    expect(final.parish, "parish became non-null during the run").toBeNull();
    // UNCHANGED, not false. This line predates 20260908015405, when the column
    // lock stopped hardcoding `is_seed := false` and began DERIVING it from the
    // posting account. The insert-time check above was updated to match — it
    // asserts the flag equals `profiles.is_seed`, which is true for these
    // @mailinator.com fixture accounts — but this after-the-fact re-assertion
    // was not, so it demanded `false` for a job the database had correctly
    // flagged `true` from the moment it was created. On 2026-09-12 that was the
    // ONLY failure in a run that had posted, funded through Stripe test
    // checkout, hired, confirmed arrival, uploaded both photos, completed,
    // released and reviewed. The claim this line exists to make is "nothing in
    // the loop could CHANGE is_seed", so it is compared against the value the
    // job was created with.
    expect(final.is_seed, "nothing in the loop should have been able to change is_seed").toBe(posterRow.is_seed);

    // And the thing that matters most: this job never became publicly visible.
    const anonBrowse = await request.get(
      `${SUPABASE_URL}/rest/v1/open_jobs_browse?id=eq.${job.id}&select=id`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
    );
    expect(anonBrowse.ok(), `anon browse read failed: ${anonBrowse.status()}`).toBe(true);
    expect(
      await anonBrowse.json(),
      "the test job was visible to a signed-out visitor in open_jobs_browse",
    ).toHaveLength(0);
  });
});

export { E2E_TITLE_MARKER };
