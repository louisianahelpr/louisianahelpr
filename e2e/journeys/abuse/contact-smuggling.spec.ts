import { test, expect, getSession, rest, sessionsAvailable, SUPABASE_URL, E2E_TITLE_MARKER, announceUncovered, skipUncovered } from "../fixtures";

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
      const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
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
      expect(body, "the rejection should carry the trigger's user-readable message").toMatch(/detected in the job description/i);
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
      expect(body, "the rejection should carry the trigger's user-readable message").toMatch(/detected in your bio/i);
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
    const shared = (await request.get(
      `${SUPABASE_URL}/rest/v1/jobs?helper_id=eq.${helper.user.id}&customer_id=eq.${posterId}&payment_status=in.(escrow,payout_pending,released)&select=id&limit=1`,
      { headers: posterHeaders },
    ).then((r) => r.json())) as Array<{ id: string }>;
    if (!shared.length) {
      skipUncovered("Message smuggling not exercised", "no funded poster↔helper thread available; the funded lifecycle spec owns that setup. The gate itself is unit-tested in src/lib/messageScanner.test.ts and contactFilterParity.test.ts.");
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
  });
});
