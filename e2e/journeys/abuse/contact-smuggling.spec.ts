import { test, expect, getSession, rest, sessionsAvailable, SUPABASE_URL, E2E_TITLE_MARKER, announceUncovered, skipUncovered } from "../fixtures";

/**
 * BAD ACTORS — contact-detail smuggling (terminal 7).
 *
 * The server gate is public.contact_leak_reason(text), called BEFORE INSERT by
 * scan_message_content (messages) and scan_application_contact_info
 * (applications). Live on 2026-09-12, information_schema.triggers shows NO
 * contact-scan trigger on `profiles` or `jobs`, so a phone/email/off-platform
 * string in a BIO or a JOB DESCRIPTION is stored verbatim and shown to the other
 * party — undetected. This spec proves that live (the SECURITY finding in
 * docs/OPEN.md) and exercises the message gate where a funded thread exists.
 *
 * Verification is live: after each write we read the stored row back and check
 * whether the gate acted (flagged_hidden / flag_reason), never trusting the UI.
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
    test(`job description smuggling is UNFILTERED server-side: ${s.label}`, async ({ request }) => {
      const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
        headers: { ...posterHeaders, Prefer: "return=representation" },
        data: {
          title: `${E2E_TITLE_MARKER} smuggle ${s.label} ${runId}`,
          description: `Regular job text. ${s.text}`,
          category: "cleaning",
          parish: "East Baton Rouge",
          budget: 50,
          payment_type: "fixed",
          payment_status: "unpaid",
          status: "open",
          is_seed: true,
        },
      });
      expect(created.ok(), `job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
      const row = (await created.json())[0] as { id: string; description: string };
      createdJobs.push(row.id);
      // The contact string is stored verbatim — there is no jobs description scan.
      // This is the SECURITY finding; the assertion documents the gap so the day a
      // scan trigger is added, this test flips and must be updated to expect a flag.
      expect(row.description, `job description scan now exists — update this finding (${s.label})`).toContain(s.text);
    });
  }

  test("profile bio smuggling is UNFILTERED server-side", async ({ request }) => {
    // Read the current bio, write a smuggled one, read it back, then restore.
    const key = `bio`;
    const before = (await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}&select=${key}`, { headers: posterHeaders }).then((r) => r.json()))[0]?.[key] ?? null;
    const smuggled = `Experienced helper. Call 504-555-0100 or venmo me. ${runId}`;
    const upd = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { [key]: smuggled },
    });
    try {
      expect(upd.ok(), `bio update failed: ${upd.status()} ${await upd.text()}`).toBe(true);
      const after = (await upd.json())[0]?.[key];
      expect(after, "profile bio scan now exists — update this finding").toBe(smuggled);
    } finally {
      // Restore the original bio no matter what.
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
