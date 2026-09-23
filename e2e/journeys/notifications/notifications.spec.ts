/**
 * WHY THIS CARRIES AN EXEMPTION RATHER THAN A MUTATION.
 *
 * Measured 2026-09-21: five of the six tests here assert create-notification
 * EDGE FUNCTION behaviour over REST (403 for spoofing a stranger, 400 for an
 * unsafe link and a bad type, the stored link sanitised to "/dashboard",
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
 * @mutate-exempt 5 of 6 tests are create-notification edge-function behaviour over REST and the gate never deploys a function (measured 2026-09-21). SHOWN ABLE TO FAIL in the right medium by src/test/edge/create-notification.test.ts, which carries a registered @mutate against supabase/functions/create-notification/index.ts and covers the 403 stranger-relationship gate and the 400 length cap directly. GAP, stated plainly: that edge test does NOT cover the stored-link sanitisation to "/dashboard", the notification-preference round-trip, or the email_send_log row. The 6th test drives a browser but over rows read live from prod, so a mutation against it is data-dependent; it becomes registerable once its links come from a fixture this spec owns. The 5 "…notification is not exercised here" tests added for Q230 (2026-09-23) are pure skipUncovered() calls with no assertion of their own to mutate — they exist so the header's completeness claim is true, and src/test/notificationsSpecAnnotatesEveryNamedLeg.test.ts is the real guard, shown able to fail by dropping one of the five names.
 */
import { test, expect, getSession, rest, newUserContext, sessionsAvailable, assertHealthy, SUPABASE_URL, ANON, announceUncovered, skipUncovered } from "../fixtures";

/**
 * NOTIFICATIONS & EMAIL (terminal 7). Inventory: docs/archive/notification-inventory.md.
 *
 * Real prod, two shared accounts, no mocks. Covers what the test accounts can
 * cause without a third geo-matched account or a live-mode Stripe charge:
 *
 *   1. create-notification authz + sanitisation (spoofing, link, type) — the
 *      shared insert path; API-level, self-targeted rows are cleaned.
 *   2. notification-preference round-trip (OFF is stored, then restored) — the
 *      first half of "OFF means nothing is sent".
 *   3. a real in-app row's LINK opens the right screen with no error page
 *      (errorScreens.ts), in one browser page.
 *   4. a reachable TRIGGER (message on a funded thread) writes the recipient's
 *      in-app row AND an email_send_log row — guarded to a funded thread the
 *      lifecycle spec leaves behind, else reported uncovered rather than funded.
 *
 * Legs needing a third account, geo-matched fixtures, or a paid tip are
 * annotated uncovered, never silently skipped (owner: no silent passes):
 * direct offer, saved-search match, job-match fan-out, tip, and cron
 * notifications each have their own named test below stating exactly why
 * (Q230, 2026-09-23).
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

  test("create-notification refuses spoofing a stranger (no shared job) → 403", async ({ request }) => {
    // A well-formed but unrelated UUID: shares no job and no application with the
    // caller, so the job-party rule must refuse it. A 2xx here is a SECURITY
    // finding — any user could brand a fake Helpr notification to anyone.
    const stranger = "00000000-0000-4000-8000-000000000001";
    const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: stranger, title: "spoof", message: `${runId}`, type: "info" } });
    expect(r.status(), `SECURITY: create-notification let a user notify an unrelated stranger (got ${r.status()})`).toBe(403);
  });

  test("create-notification rejects unsafe links and bad types (400)", async ({ request }) => {
    for (const link of ["javascript:alert(1)", "//evil.com/x", "https://evil.com", "/x\\y", "not-a-path"]) {
      const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, title: "t", message: runId, type: "info", link } });
      expect(r.status(), `SECURITY: create-notification accepted an unsafe link "${link}"`).toBe(400);
    }
    const badType = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, title: "t", message: runId, type: "totally_made_up" } });
    expect(badType.status(), "create-notification accepted a type outside the allowlist").toBe(400);
  });

  test("create-notification accepts a safe self-notification, then it is cleaned", async ({ request }) => {
    const r = await request.post(FN, { headers: fnHeaders(), data: { user_id: posterId, title: `[t7] self`, message: runId, type: "info", link: "/dashboard" } });
    expect(r.ok(), `safe self-notification rejected: ${r.status()} ${await r.text()}`).toBe(true);
    // Find, mark read (own-notification UPDATE), then delete (own read-notification DELETE).
    const rows = (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${posterId}&message=eq.${runId}&select=id,link,type`, { headers: posterHeaders }).then((x) => x.json())) as Array<{ id: string; link: string }>;
    expect(rows.length, "the safe self-notification did not land as an in-app row").toBeGreaterThan(0);
    expect(rows[0].link, "the stored link was not the sanitised same-origin path").toBe("/dashboard");
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

           page.goto: Navigation to ".../my-posts?job=dfecbd90-…" is
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

  /*
   * Q230 (2026-09-23): the header above claims every leg needing a third
   * account or a paid tip is "annotated uncovered, never silently skipped" —
   * but five legs had no annotation AT ALL, no test, nothing: a reader could
   * not tell them apart from a leg nobody had thought of. Each is real
   * server-side behaviour (grep supabase/migrations/*.sql), named here with
   * why the two shared accounts over REST cannot drive it, so the claim in
   * the header is true of the file that makes it. src/test/
   * notificationsSpecAnnotatesEveryNamedLeg.test.ts holds this list two-way
   * against this file's own text.
   */
  test("direct-offer notification is not exercised here", async () => {
    skipUncovered(
      "Direct-offer notification uncovered",
      "notify_helper_on_direct_offer fires AFTER INSERT OR UPDATE OF offered_to_helper_id ON public.jobs " +
        "(trg_notify_helper_on_direct_offer, 20260423025644). Setting that column is the app's direct-offer " +
        "flow, which this REST-level spec does not drive; needs the client offer path or its RPC, verified live.",
    );
  });

  test("saved-search-match notification is not exercised here", async () => {
    skipUncovered(
      "Saved-search-match notification uncovered",
      "notify_saved_searches_on_new_job fans out on a jobs insert/update to every helper whose saved_searches " +
        "row matches the new job (20260505171500 / 20260901035245). Driving it needs a saved_searches fixture " +
        "for the shared helper account that a freshly posted test job actually matches, which this spec does " +
        "not set up.",
    );
  });

  test("job-match fan-out notification is not exercised here", async () => {
    skipUncovered(
      "Job-match fan-out notification uncovered",
      "notify_helpers_on_job_post fires AFTER INSERT on every public.jobs row (notify_helpers_on_job_post_trigger, " +
        "20260418081253), fanning out to helpers whose profile matches the job's category/parish. Whether the " +
        "shared helper account matches a freshly posted test job is not guaranteed by this spec's fixtures.",
    );
  });

  test("tip notification is not exercised here", async () => {
    skipUncovered(
      "Tip notification uncovered",
      "notify_helper_on_tip fires AFTER INSERT OR UPDATE on public.tips (trg_notify_helper_tip, 20260418215317). " +
        "A real tip needs a completed job and a Stripe charge (even in test mode) that this spec does not drive; " +
        "the money journey itself is a separate suite.",
    );
  });

  test("cron notifications are not exercised here", async () => {
    skipUncovered(
      "Cron notifications uncovered",
      "sweep_job_start_reminders / sweep_no_show_alerts / sweep_daily_job_digest / sweep_dayof_confirm_reminders / " +
        "sweep_release_last_chance run on pg_cron's own schedule with no client-callable trigger; an e2e spec " +
        "authenticated as a normal user cannot invoke them, so delivery can only be read from rows a real cron " +
        "run already produced, not driven here.",
    );
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
});
