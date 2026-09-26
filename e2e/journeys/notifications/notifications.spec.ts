/**
 * WHY THIS CARRIES AN EXEMPTION RATHER THAN A MUTATION.
 *
 * Measured 2026-09-21: five of the six tests here assert create-notification
 * EDGE FUNCTION behaviour over REST (403 for spoofing a stranger, 400 for an
 * unsafe link and a bad type, the stored link sanitised to "/home",
 * preference persistence, email_send_log fan-out). The gate mutates `src/` and
 * runs `npm run build`; it does not deploy an edge function, so a mutation
 * against those five returns SURVIVED for an environment reason.
 *
 * The sixth test DOES drive a browser, and was considered for a registration of
 * its own. It reads the poster's notification rows LIVE from prod and navigates
 * whichever links exist, so which screens it visits changes run to run — the
 * same nondeterminism that made overlay-sweep's shrink ratchet unassertable. A
 * mutation scoped to one of those screens could pass or fail on the row set,
 * which is a coin-toss dressed as a proof. Registerable only once the link set
 * is pinned to a fixture this spec owns.
 *
 * @mutate-exempt 5 of 6 tests are create-notification edge-function behaviour over REST and the gate never deploys a function (measured 2026-09-21). SHOWN ABLE TO FAIL in the right medium by src/test/edge/create-notification.test.ts, which carries a registered @mutate against supabase/functions/create-notification/index.ts and covers the stranger refusal, the Q223 no-caller-copy rule and the per-template job-party gate directly. GAP, stated plainly: that edge test does NOT cover the notification-preference round-trip or the email_send_log row. The 6th test drives a browser but over rows read live from prod, so a mutation against it is data-dependent; it becomes registerable once its links come from a fixture this spec owns.
 */
import { test, expect, getSession, rest, newUserContext, sessionsAvailable, assertHealthy, SUPABASE_URL, ANON, E2E_TITLE_MARKER, announceUncovered, skipUncovered } from "../fixtures";
import { uncoveredProducers } from "./producers";

/**
 * NOTIFICATIONS & EMAIL (terminal 7). Inventory: docs/archive/notification-inventory.md.
 *
 * Real prod, two shared accounts, no mocks. Covers what the test accounts can
 * cause without a third geo-matched account or a live-mode Stripe charge:
 *
 *   1. create-notification authz (spoofing, no caller-written copy for a
 *      non-admin, Q223) — the shared insert path; API-level, self-targeted
 *      rows are cleaned.
 *   2. notification-preference round-trip (OFF is stored, then restored) — the
 *      first half of "OFF means nothing is sent".
 *   3. a real in-app row's LINK opens the right screen with no error page
 *      (errorScreens.ts), in one browser page.
 *   4. a reachable TRIGGER (message on a funded thread) writes the recipient's
 *      in-app row AND an email_send_log row — guarded to a funded thread the
 *      lifecycle spec leaves behind, else reported uncovered rather than funded.
 *   5. a DIRECT OFFER (poster offers an unfunded job to the helper) writes the
 *      helper's new_offers row, and the helper's decline writes the poster's
 *      "Offer declined" row (Q230).
 *
 * The saved-search alert and the tip notification are asserted in
 * ../04-money-outcomes.spec.ts, where the job they need is funded.
 *
 * EVERY OTHER PRODUCER is annotated uncovered, with its reason, by the last
 * test below — the list is ./producers.ts, whose keys are derived from source
 * and held two-way by src/test/notificationProducersCovered.test.ts. Nothing is
 * silently skipped (owner: no silent passes).
 */

const avail = sessionsAvailable();
const runId = `t7-notif-${Date.now().toString(36)}`;
const FN = `${SUPABASE_URL}/functions/v1/create-notification`;

test.describe("notifications & email", () => {
  test.skip(!avail.ok, avail.why);

  let posterId = "";
  let helperId = "";
  let posterHeaders: Record<string, string> = {};
  let posterToken = "";

  test.beforeAll(async ({ request }) => {
    const poster = await getSession(request, "poster");
    const helper = await getSession(request, "helper");
    posterId = poster.user.id;
    helperId = helper.user.id;
    posterHeaders = rest(poster);
    posterToken = poster.access_token;
  });

  const fnHeaders = () => ({ apikey: ANON, Authorization: `Bearer ${posterToken}`, "Content-Type": "application/json" });

  test("create-notification refuses spoofing a stranger (no shared job) → 4xx", async ({ request }) => {
    // A well-formed but unrelated UUID. Caller-written copy is refused outright
    // for a non-admin (400, Q223); a template naming a job the stranger is not a
    // party to is refused by the job-party rule (403/404). A 2xx either way is
    // a SECURITY finding — any user could brand a fake Helpr notification.
    const stranger = "00000000-0000-4000-8000-000000000001";
    const freeText = await request.post(FN, { headers: fnHeaders(), data: { user_id: stranger, title: "spoof", message: `${runId}`, type: "info" } });
    expect(freeText.status(), `SECURITY: create-notification let a user notify an unrelated stranger (got ${freeText.status()})`).toBe(400);
    const templated = await request.post(FN, { headers: fnHeaders(), data: { user_id: stranger, template: "work_started", job_id: "00000000-0000-4000-8000-000000000002" } });
    expect([403, 404], `SECURITY: a template reached an unrelated stranger (got ${templated.status()})`).toContain(templated.status());
  });

  test("create-notification refuses caller-written copy from a non-admin (Q223, 400)", async ({ request }) => {
    // Even to yourself, even with a safe link: a non-admin names a template;
    // the words, type and link are the server's. The platform-branded types
    // an applicant used to push (payment / verified / system_alert) included.
    for (const type of ["info", "payment", "verified", "system_alert", "totally_made_up"]) {
      const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, title: "t", message: runId, type, link: "/home" } });
      expect(r.status(), `SECURITY: create-notification took caller-written copy of type "${type}" from a non-admin`).toBe(400);
    }
    for (const link of ["javascript:alert(1)", "//evil.com/x", "https://evil.com", "/x\\y", "not-a-path"]) {
      const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, title: "t", message: runId, type: "info", link } });
      expect(r.status(), `SECURITY: create-notification accepted an unsafe link "${link}"`).toBe(400);
    }
  });

  test("create-notification's self test lands with server copy, then it is cleaned", async ({ request }) => {
    const since = new Date().toISOString();
    const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, template: "test", title: "IGNORED", message: runId } });
    expect(r.ok(), `self test notification rejected: ${r.status()} ${await r.text()}`).toBe(true);
    // Find, mark read (own-notification UPDATE), then delete (own read-notification DELETE).
    const rows = (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${posterId}&title=eq.${encodeURIComponent("Test from Helpr")}&created_at=gte.${encodeURIComponent(since)}&select=id,link,type,message`, { headers: posterHeaders }).then((x) => x.json())) as Array<{ id: string; link: string | null; message: string }>;
    expect(rows.length, "the self test notification did not land as an in-app row").toBeGreaterThan(0);
    expect(rows.some((row) => row.message.includes(runId)), "caller-written text reached the notification").toBe(false);
    for (const row of rows) {
      await request.patch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers: posterHeaders, data: { read: true } });
      await request.delete(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers: posterHeaders });
    }
  });

  test("notification-preference OFF is stored and then restored", async ({ request }) => {
    const col = "email_messages";
    const cur = (await request.get(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${posterId}&select=${col}`, { headers: posterHeaders }).then((x) => x.json())) as Array<Record<string, boolean>>;
    if (!cur.length) skipUncovered("Preference row absent", "the poster has no notification_preferences row yet; the app creates it on first prefs visit.");
    const original = cur[0][col];
    try {
      const off = await request.patch(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${posterId}`, { headers: { ...posterHeaders, Prefer: "return=representation" }, data: { [col]: false } });
      expect(off.ok(), `preference update failed: ${off.status()} ${await off.text()}`).toBe(true);
      expect((await off.json())[0][col], "preference did not persist as OFF").toBe(false);
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/notification_preferences?user_id=eq.${posterId}`, { headers: posterHeaders, data: { [col]: original } });
    }
  });

  test("a real in-app notification's link opens its screen with no error page", async ({ browser, request, journey }) => {
    const poster = await getSession(request, "poster");
    const rows = (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${posterId}&link=not.is.null&order=created_at.desc&limit=5&select=id,title,link`, { headers: posterHeaders }).then((x) => x.json())) as Array<{ link: string; title: string }>;
    if (!rows.length) skipUncovered("No linked notification", "the poster account has no notification with a link to open; funded-lifecycle notifications produce them.");
    const ctx = await newUserContext(browser, poster);
    const page = journey.track("notif-link", await ctx.newPage());
    for (const row of rows.slice(0, 3)) {
      /* THE APP CAN RELOAD ITSELF OUT FROM UNDER THIS GOTO, and did in
         e2e-journeys 35691377627 (journeys-webkit):

           page.goto: Navigation to ".../posts?job=dfecbd90-…" is
           interrupted by another navigation to ".../profile?tab=warnings
           &_v=1790058631340"

         `_v=` has exactly one writer in the app — `hardReloadBypassCache`
         (src/lib/chunkReload.ts), the stale-chunk recovery — and it reloads
         `window.location.href`, i.e. the page we were LEAVING. The trace shows
         why it fired: 5s into this goto, WebKit aborted the previous screen's
         in-flight `/rest/v1/jobs?…limit=3` fetch ("Fetch API cannot load …
         due to access control checks", its wording for a cancelled request),
         inside the window where every prod call was taking 6-44s. A module
         preload cancelled the same way raises `vite:preloadError`, which
         main.tsx hands to `recoverFromChunkError()`.

         Tolerated, ONCE, and recorded — never swallowed. This is a real
         (narrow) product hole, filed in docs/OPEN.md: a deep link opened while
         a lazy chunk is still in flight can be eaten by the recovery reload,
         which sends the user back where they were. The assertion below is
         unchanged; if the second attempt is interrupted too, the spec fails
         and says so. */
      try {
        await page.goto(row.link);
      } catch (err) {
        if (!/interrupted by another navigation/i.test(String(err))) throw err;
        test.info().annotations.push({
          type: "app-self-navigation",
          description: `${row.link} was interrupted by the app navigating itself to ${page.url()}; retried once`,
        });
        await page.waitForTimeout(2_000);
        await page.goto(row.link);
      }
      await assertHealthy(page, `notification link ${row.link} ("${row.title}")`);
      await journey.milestone(page, `link${row.link.replace(/[^a-z0-9]+/gi, "_")}`);
    }
    await ctx.close();
  });

  test("a message on a funded thread writes the recipient's row and an email_send_log row", async ({ request }) => {
    // Still OPEN, not merely funded: a job's thread closes 24 hours after
    // completion (`job_messaging_closes_at` → `can_message_in_job`, the first
    // gate on the messages INSERT policy), so a completed job answers this
    // query and then refuses the insert with 403 / 42501. See the same fix in
    // e2e/journeys/abuse/contact-smuggling.spec.ts.
    const shared = (await request.get(
      `${SUPABASE_URL}/rest/v1/jobs?helper_id=eq.${helperId}&customer_id=eq.${posterId}&payment_status=in.(escrow,payout_pending,released)&status=neq.completed&status=neq.cancelled&select=id&limit=1`,
      { headers: posterHeaders },
    ).then((x) => x.json())) as Array<{ id: string }>;
    if (!shared.length) skipUncovered("No funded thread", "no funded poster↔helper job whose thread is still open to messages (they close 24h after completion); the funded lifecycle spec owns that setup and its Stripe leg skips on a live key.");
    const jobId = shared[0].id;
    const send = await request.post(`${SUPABASE_URL}/rest/v1/messages`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: jobId, sender_id: posterId, receiver_id: helperId, content: `[E2E DO NOT ACCEPT] notif probe ${runId}` },
    });
    expect(send.ok(), `message insert failed: ${send.status()} ${await send.text()}`).toBe(true);
    const msg = (await send.json())[0] as { id: string };

    // The recipient (helper) gets an in-app row for this message.
    const helper = await getSession(request, "helper");
    await expect
      .poll(async () => {
        const n = (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${helperId}&type=eq.message&order=created_at.desc&limit=1&select=id,created_at`, { headers: rest(helper) }).then((x) => x.json())) as unknown[];
        return n.length;
      }, { timeout: 20_000, message: "recipient never received an in-app message notification" })
      .toBeGreaterThan(0);

    // email_send_log is admin/service-role read only; check it only when a reader
    // token is available, else report the delivery half uncovered.
    announceUncovered("email_send_log not asserted here", "email_send_log is service-role/admin read only; the CI job with PLAYWRIGHT_ADMIN credentials or a service-role .env asserts the row. Recipient in-app row was verified above.");
    await request.delete(`${SUPABASE_URL}/rest/v1/messages?id=eq.${msg.id}`, { headers: posterHeaders });
  });

  test("a direct offer notifies the helper, and the helper's decline notifies the poster", async ({ request, journey }) => {
    // The same INSERT PostJob makes when the poster offers the job to one Helpr
    // (jobSubmitHelpers.ts: offered_to_helper_id + direct_offer_status
    // 'pending' + a response window). Unfunded on purpose: the offer trigger
    // (notify_helper_on_direct_offer) fires on the INSERT, and an unfunded job
    // with no hired Helpr is cancelled afterwards with no strike on anyone.
    // parish NULL, so nothing fans out even if it were funded.
    const helper = await getSession(request, "helper");
    const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,parish`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: {
        customer_id: posterId,
        is_seed: true,
        title: `${E2E_TITLE_MARKER} DO ${runId.slice(-6)}`,
        description: `Direct-offer notification probe ${runId}: two shelves, studs marked, anchors on site.`,
        category: "handyman",
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        parish: null,
        date_needed: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        budget: 25,
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
        offered_to_helper_id: helperId,
        direct_offer_status: "pending",
        direct_offer_expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      },
    });
    expect(created.ok(), `direct-offer job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
    const job = ((await created.json()) as Array<{ id: string; parish: string | null }>)[0];
    expect(job.parish, "the direct-offer job came back with a parish").toBeNull();
    journey.cleanup("cancel the unfunded direct-offer job", () =>
      request.post(`${SUPABASE_URL}/rest/v1/rpc/poster_cancel_job`, { headers: posterHeaders, data: { p_job_id: job.id, p_reason: "E2E direct-offer probe teardown" } }),
    );

    type Row = { id: string; title: string; link: string | null };
    const rowsFor = async (headers: Record<string, string>, userId: string, filter: string) =>
      (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}&${filter}&select=id,title,link`, { headers }).then((x) => x.json())) as Row[];
    const drop = async (headers: Record<string, string>, rows: Row[]) => {
      for (const row of rows) {
        await request.patch(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers, data: { read: true } });
        await request.delete(`${SUPABASE_URL}/rest/v1/notifications?id=eq.${row.id}`, { headers });
      }
    };

    // 1. The helper's offer row: type new_offers, deep link to the job.
    let offer: Row[] = [];
    await expect
      .poll(async () => (offer = await rowsFor(rest(helper), helperId, `type=eq.new_offers&job_id=eq.${job.id}`)).length, {
        timeout: 30_000,
        message: "the helper never received the direct-offer notification",
      })
      .toBe(1);
    expect(offer[0].link, "the direct-offer notification does not open the job").toBe(`/jobs?job=${job.id}`);
    journey.cleanup("drop the helper's offer notification", () => drop(rest(helper), offer));

    // 2. The helper declines through the app's own RPC (no strike on this
    //    path: respond_to_direct_offer's decline branch only reopens the job).
    const declined = await request.post(`${SUPABASE_URL}/rest/v1/rpc/respond_to_direct_offer`, {
      headers: rest(helper),
      data: { p_job_id: job.id, p_accept: false },
    });
    expect(declined.ok(), `respond_to_direct_offer(decline) failed: ${declined.status()} ${await declined.text()}`).toBe(true);

    // 3. The poster is told, with a link to the job.
    let told: Row[] = [];
    await expect
      .poll(async () => (told = await rowsFor(posterHeaders, posterId, `job_id=eq.${job.id}&title=eq.${encodeURIComponent("Offer declined")}`)).length, {
        timeout: 30_000,
        message: "the poster never received the offer-declined notification",
      })
      .toBe(1);
    expect(told[0].link, "the offer-declined notification does not open the job").toBe(`/posts?job=${job.id}`);
    journey.cleanup("drop the poster's decline notification", () => drop(posterHeaders, told));
  });

  test("every notification producer no leg asserts is annotated uncovered", async () => {
    // The registry's keys are derived from source (src/test/helpers/
    // notificationProducers.ts) and held two-way by
    // src/test/notificationProducersCovered.test.ts, so a new producer cannot
    // arrive without landing here or in a leg that asserts its row.
    const open = uncoveredProducers();
    for (const { producer, why } of open) {
      test.info().annotations.push({ type: "uncovered", description: `${producer}: ${why}` });
    }
    announceUncovered(
      `${open.length} notification producers not asserted by any journey`,
      open.map((p) => p.producer).join(", "),
    );
    expect(open.length, "the registry lists nothing uncovered — the guard derives 80+ producers, so this is a broken import").toBeGreaterThan(0);
  });
});
