/**
 * WHY THIS CARRIES AN EXEMPTION RATHER THAN A MUTATION.
 *
 * Measured 2026-09-21: `grep -c "page\.\|browser"` on this file returns ZERO.
 * It never opens a browser. Every one of its 12 assertions is a REST call
 * against prod asserting that a DATABASE TRIGGER refuses the write
 * (`contact_leak_reason` -> check_violation 23514 -> HTTP 400). The vacuity gate
 * mutates a file under `src/` and runs `npm run build`; it does not run
 * `supabase db push` and does not deploy functions. So nothing it can change is
 * in this spec's path, and any `@mutate` here returns SURVIVED for an
 * environment reason — a false accusation against a real guard, wearing a green
 * tick.
 *
 * But "the gate cannot reach it" is not the answer to "is this able to fail?".
 * It is, and it was shown so in the right medium: real Postgres.
 *
 * @mutate-exempt Subject is a DB trigger, not client code: 0 browser refs, 12 REST assertions (measured 2026-09-21), and the gate never deploys migrations. SHOWN ABLE TO FAIL by scripts/probes/contact-leak-reject.probe.mjs, which replays 20260913020635_reject_contact_leaks_in_jobs_and_bios.sql in PGlite and is RED-BEFORE against the LIVE function body (pg_get_functiondef 2026-09-12 misses jane@my-domain.com; the migration catches it), then proves a phone number in a job insert and in a bio update are both rejected 23514 while clean text passes. scripts/probes/contact-scan-phone.probe.mjs covers the digit-boundary and hidden-copy half the same way.
 */
import { test, expect, getSession, optionalSession, rest, sessionsAvailable, SUPABASE_URL, E2E_TITLE_MARKER, announceUncovered, skipUncovered } from "../fixtures";

/**
 * BAD ACTORS — contact-detail smuggling (terminal 7).
 *
 * The server gate is public.contact_leak_reason(text). Messages and
 * applications are scanned-and-hidden (scan_message_content,
 * scan_application_contact_info). Since 20260913020635, job titles/descriptions
 * and profile bios are scanned too, and a leak there is REJECTED outright
 * (check_violation, 23514 → PostgREST 400 with the trigger's message) — a post
 * or a bio has no recipient to hide it from. Before that migration these were
 * stored verbatim (the SECURITY finding in docs/OPEN.md, now closed); this spec
 * is the live regression check on prod with the shared test accounts.
 *
 * Verification is live: we look at the REST status + body and read the row back,
 * never trusting the UI.
 */

const avail = sessionsAvailable();
const runId = `t7-smuggle-${Date.now().toString(36)}`;

const SMUGGLES = [
  { label: "US phone", text: "reach me at 504-555-0100 anytime" },
  { label: "email", text: "email me jane.doe@gmail.com to sort it out" },
  { label: "off-platform payment", text: "just venmo me and we skip the fee" },
];

test.describe("bad actors: contact smuggling", () => {
  test.skip(!avail.ok, avail.why);

  let posterId = "";
  let posterHeaders: Record<string, string> = {};
  const createdJobs: string[] = [];

  test.beforeAll(async ({ request }) => {
    const poster = await getSession(request, "poster");
    posterId = poster.user.id;
    posterHeaders = rest(poster);
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdJobs.reverse()) {
      const del = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}`, { headers: posterHeaders });
      if (!del.ok()) announceUncovered("smuggle job not cleaned", `job ${id}: ${del.status()}`);
    }
  });

  for (const s of SMUGGLES) {
    test(`job description smuggling is REJECTED server-side: ${s.label}`, async ({ request }) => {
      // `select=` is required alongside return=representation on jobs:
      // bare representation is RETURNING *, and authenticated lost the
      // table-level SELECT on jobs in 20260915045110, so `*` 42501s. Without
      // it a REGRESSION (the gate gone, the row stored) would come back as a
      // permission error instead of the 400 this asserts — and the row would
      // never reach `createdJobs`, so it would be left on prod.
      const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
        headers: { ...posterHeaders, Prefer: "return=representation" },
        data: {
          customer_id: posterId,
          title: `${E2E_TITLE_MARKER} smuggle ${s.label} ${runId}`,
          description: `Regular job text. ${s.text}`,
          category: "cleaning",
          budget: 50,
          location: "Baton Rouge, LA",
          date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
          status: "open",
          payment_status: "unpaid",
          pricing_mode: "set_price",
          is_seed: true,
        },
      });
      const body = await created.text();
      if (created.ok()) {
        // The gate is gone: clean up the row so the leak is not left on prod.
        const row = (JSON.parse(body) as Array<{ id: string }>)[0];
        if (row?.id) createdJobs.push(row.id);
      }
      expect(created.status(), `SECURITY: a ${s.label} in a job description was STORED, not rejected: ${body}`).toBe(400);
      expect(body, "the rejection should carry the trigger's user-readable message").toMatch(/(detected|mentioned) in the job description/i);
      const stored = await request.get(`${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${posterId}&title=ilike.*smuggle ${s.label} ${runId}*&select=id`, { headers: posterHeaders }).then((r) => r.json());
      expect(stored, "no row must exist after a rejected insert").toEqual([]);
    });
  }

  test("profile bio smuggling is REJECTED server-side", async ({ request }) => {
    // Read the current bio, write a smuggled one, read it back, then restore.
    const key = `bio`;
    const before = (await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}&select=${key}`, { headers: posterHeaders }).then((r) => r.json()))[0]?.[key] ?? null;
    const smuggled = `Experienced helper. Call 504-555-0100 or venmo me. ${runId}`;
    const upd = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { [key]: smuggled },
    });
    try {
      const body = await upd.text();
      expect(upd.status(), `SECURITY: a phone number + venmo in a bio was STORED, not rejected: ${body}`).toBe(400);
      expect(body, "the rejection should carry the trigger's user-readable message").toMatch(/(detected|mentioned) in your bio/i);
      const after = (await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}&select=${key}`, { headers: posterHeaders }).then((r) => r.json()))[0]?.[key] ?? null;
      expect(after, "bio must be unchanged after a rejected update").toBe(before);
    } finally {
      // Restore the original bio no matter what (a no-op when the gate held).
      await request.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}`, { headers: posterHeaders, data: { [key]: before } });
    }
  });

  test("message-thread contact smuggling is caught by the server gate", async ({ request }) => {
    // The messages gate is well-covered; sending one needs a funded job both
    // accounts belong to. That funded setup is owned by the lifecycle spec — if a
    // reusable funded thread is not present, report uncovered rather than fund one
    // here (a Stripe charge for a filter test is not warranted).
    const helper = await getSession(request, "helper");
    // `status=neq.completed` is not decoration: messaging on a job CLOSES 24
    // hours after completion (`job_messaging_closes_at`, called by
    // `can_message_in_job`, the first gate the messages INSERT policy checks).
    // Without it this query happily returned a job completed weeks ago, the
    // insert came back 403 / 42501, and the suite read a closed thread — the
    // product working as designed — as a failure of the contact filter. Every
    // funded job these two accounts share is completed and long closed, which
    // is why this went red nightly (2026-09-15).
    const shared = (await request.get(
      `${SUPABASE_URL}/rest/v1/jobs?helper_id=eq.${helper.user.id}&customer_id=eq.${posterId}&payment_status=in.(escrow,payout_pending,released)&status=neq.completed&status=neq.cancelled&select=id&limit=1`,
      { headers: posterHeaders },
    ).then((r) => r.json())) as Array<{ id: string }>;
    if (!shared.length) {
      skipUncovered("Message smuggling not exercised", "no funded poster↔helper thread that is still OPEN to messages (they close 24h after completion); the funded lifecycle spec owns that setup. The gate itself is unit-tested in src/lib/messageScanner.test.ts and contactFilterParity.test.ts.");
    }
    const jobId = shared[0].id;
    const send = await request.post(`${SUPABASE_URL}/rest/v1/messages`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: jobId, sender_id: posterId, receiver_id: helper.user.id, content: `${E2E_TITLE_MARKER} call me 504-555-0100` },
    });
    expect(send.ok(), `message insert failed: ${send.status()} ${await send.text()}`).toBe(true);
    const msg = (await send.json())[0] as { id: string; flagged_hidden: boolean; flag_reason: string | null };
    expect(msg.flagged_hidden, "SECURITY: a phone number in a message was NOT flagged_hidden by the server gate").toBe(true);
    expect(msg.flag_reason, "flag_reason should name the detected class").toMatch(/phone/i);
    await request.delete(`${SUPABASE_URL}/rest/v1/messages?id=eq.${msg.id}`, { headers: posterHeaders });

    // ── UNDO THE CONSEQUENCE LADDER, then PROVE it is undone ────────────────
    //
    // This test deliberately trips a safety mechanism on a SHARED account.
    // Deleting the message was never enough: `messages_scan_consequence` →
    // `apply_message_scan_consequence` (AFTER INSERT, SECURITY DEFINER) also
    // writes a `fraud_flags` row AND calls `message_violation_ladder`, which
    // inserts a `user_violations` row and escalates on the COUNT of prior
    // off_platform violations (rungs: warning → final_warning →
    // pending_ban_review + a 7-day restriction).
    //
    // Nothing cleaned those up, so they accumulated one per night:
    //   2026-09-15  warning        (nightly-red: prod-audit #1618 opened)
    //   2026-09-17  final_warning  (profiles.ban_status stamped 'final_warning')
    // and the shared poster account was ONE nightly run from a 7-day
    // restriction that would have broken every prod workflow. 18 matching
    // fraud_flags rows had piled up alongside.
    //
    // Deleting the violation each run keeps the ladder's prior-count at 0, so
    // this test can never escalate past its first rung. Both tables are
    // admin-only (`has_role(auth.uid(), 'admin')` on user_violations and
    // fraud_flags — verified live in pg_policies), so cleanup needs the admin
    // session. Running this test WITHOUT the ability to clean up is what
    // poisoned the account, so a missing admin session is a hard failure here,
    // not a skip.
    const admin = await optionalSession(request, "admin");
    expect(
      admin,
      "no admin session: this test writes an admin-only user_violations row it cannot then delete — " +
        "set PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD (see e2e/journeys/fixtures.ts) rather than leaving a strike on the shared poster",
    ).toBeTruthy();
    const adminHeaders = rest(admin!);
    const marker = encodeURIComponent(`*${E2E_TITLE_MARKER}*`);
    await request.delete(
      `${SUPABASE_URL}/rest/v1/user_violations?user_id=eq.${posterId}&violation_type=eq.off_platform&description=like.${marker}`,
      { headers: adminHeaders },
    );
    await request.delete(
      `${SUPABASE_URL}/rest/v1/fraud_flags?user_id=eq.${posterId}&flag_type=eq.off_platform_contact&details=like.${marker}`,
      { headers: adminHeaders },
    );

    // Read it back as admin — a DELETE that matched zero rows returns 204 too
    // (CLAUDE.md: "a null error is not a write"), so the only honest proof is
    // the re-read. This is the check for the whole class: it goes red the
    // moment the ladder writes somewhere this cleanup does not reach.
    const left = (await request.get(
      `${SUPABASE_URL}/rest/v1/user_violations?user_id=eq.${posterId}&violation_type=eq.off_platform&select=id,action_taken,description`,
      { headers: adminHeaders },
    ).then((r) => r.json())) as Array<{ id: string; action_taken: string; description: string }>;
    expect(
      left,
      `this test left ${left.length} off_platform violation(s) on the shared poster — the ladder escalates on that count and the third one restricts the account for 7 days: ${JSON.stringify(left)}`,
    ).toEqual([]);

    const [prof] = (await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}&select=ban_status`,
      { headers: adminHeaders },
    ).then((r) => r.json())) as Array<{ ban_status: string | null }>;
    expect(
      prof?.ban_status ?? "active",
      "the ladder escalated profiles.ban_status on the shared poster — every prod workflow signs in as this account",
    ).toBe("active");
  });
});
