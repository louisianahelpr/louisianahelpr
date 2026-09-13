import { test, expect, getSession, rest, sessionsAvailable, SUPABASE_URL, E2E_TITLE_MARKER, announceUncovered } from "../fixtures";
import type { APIRequestContext } from "@playwright/test";

/**
 * BAD ACTORS — IDOR and authorization (terminal 7).
 *
 * Two REAL signed-in accounts (poster-e2e, helper-e2e) against PROD. No mocks
 * (owner, 2026-09-12). Every attempt is a direct supabase-js/PostgREST call — the
 * shape a page's own client could send — because the RLS policies, not the UI,
 * are the gate. Expectations are pinned to the LIVE policies and BEFORE-triggers
 * read on 2026-09-12 (pg_policies / information_schema.triggers):
 *
 *   - reviews INSERT with_check: job.status='completed', payment_status in
 *     (released,payout_pending), reviewee is the OTHER party  → self-review and
 *     review-without-completed-job are refused.
 *   - jobs money columns: trg_poster_jobs_money_lock + prevent_job_field_escalation
 *     → a poster cannot raise/alter price or fee on their own job by UPDATE.
 *   - every SELECT policy is owner/party-scoped → a cross-account read returns [].
 *
 * A read that returns another account's row, or a write the policy should refuse
 * landing a row, is a SECURITY finding (docs/OPEN.md). Everything here is
 * read-only or a write the server is expected to reject (no durable row), so the
 * only rows created are one unfunded marker job used as an IDOR target, deleted
 * in teardown.
 */

const avail = sessionsAvailable();
const runId = `t7-idor-${Date.now().toString(36)}`;

test.describe("bad actors: IDOR & authz", () => {
  test.skip(!avail.ok, avail.why);

  // Shared target: one unfunded job owned by the poster. Unfunded + open, so the
  // poster can delete it (jobs DELETE policy), and it never reaches a money sweep.
  let posterId = "";
  let helperId = "";
  let targetJobId = "";
  let posterHeaders: Record<string, string> = {};
  let helperHeaders: Record<string, string> = {};

  test.beforeAll(async ({ request }) => {
    const poster = await getSession(request, "poster");
    const helper = await getSession(request, "helper");
    posterId = poster.user.id;
    helperId = helper.user.id;
    posterHeaders = rest(poster);
    helperHeaders = rest(helper);

    const created = await request.post(`${SUPABASE_URL}/rest/v1/jobs`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: {
        customer_id: posterId,
        title: `${E2E_TITLE_MARKER} idor target ${runId}`,
        description: "Unfunded IDOR target; safe to delete.",
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
    expect(created.ok(), `target job insert failed: ${created.status()} ${await created.text()}`).toBe(true);
    targetJobId = (await created.json())[0].id;
  });

  test.afterAll(async ({ request }) => {
    if (!targetJobId) return;
    const del = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}`, { headers: posterHeaders });
    if (!del.ok()) announceUncovered("IDOR target not cleaned", `job ${targetJobId}: ${del.status()} ${await del.text()}`);
  });

  async function selectAs(request: APIRequestContext, headers: Record<string, string>, pathAndQuery: string) {
    const r = await request.get(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers });
    expect(r.ok(), `select ${pathAndQuery} failed transport-level: ${r.status()} ${await r.text()}`).toBe(true);
    return (await r.json()) as unknown[];
  }

  test("the helper cannot read the poster's job row by id (jobs SELECT is party-scoped)", async ({ request }) => {
    const rows = await selectAs(request, helperHeaders, `jobs?id=eq.${targetJobId}&select=id,title,customer_id,budget`);
    expect(rows, "SECURITY: helper read the poster's private job via IDOR").toEqual([]);
  });

  test("the helper cannot UPDATE the poster's job (jobs UPDATE qual = customer_id)", async ({ request }) => {
    const r = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}`, {
      headers: { ...helperHeaders, Prefer: "return=representation" },
      data: { budget: 1 },
    });
    // RLS returns 0 rows (200 []) rather than an error for a no-match UPDATE.
    const body = r.ok() ? await r.json() : await r.text();
    expect(Array.isArray(body) ? body : [], "SECURITY: helper modified the poster's job via IDOR").toEqual([]);
    // Confirm live the value did not move.
    const [after] = (await selectAs(request, posterHeaders, `jobs?id=eq.${targetJobId}&select=budget`)) as Array<{ budget: number }>;
    expect(after.budget, "SECURITY: the poster's job budget changed under a cross-account write").toBe(50);
  });

  test("the helper cannot DELETE the poster's job", async ({ request }) => {
    const r = await request.delete(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}`, {
      headers: { ...helperHeaders, Prefer: "return=representation" },
    });
    const body = r.ok() ? await r.json() : [];
    expect(Array.isArray(body) ? body : [], "SECURITY: helper deleted the poster's job").toEqual([]);
    const stillThere = await selectAs(request, posterHeaders, `jobs?id=eq.${targetJobId}&select=id`);
    expect(stillThere.length, "the target job survived the cross-account delete").toBe(1);
  });

  test("neither account can read the other's applications, messages or payouts", async ({ request }) => {
    // Payout transfers: policy is helper_id = auth.uid(). The poster must never
    // see the helper's transfers, nor vice-versa.
    const posterSeesHelperPayouts = await selectAs(request, posterHeaders, `payout_transfers?helper_id=eq.${helperId}&select=id,amount`);
    expect(posterSeesHelperPayouts, "SECURITY: poster read the helper's payout_transfers").toEqual([]);

    // Applications the poster owns as a helper must not be visible to the helper
    // account (and vice versa) unless they are a party.
    const helperSeesPosterApps = await selectAs(request, helperHeaders, `applications?helper_id=eq.${posterId}&select=id`);
    expect(helperSeesPosterApps, "SECURITY: helper read the poster's own applications via IDOR").toEqual([]);

    // Messages the poster sent that the helper is not the receiver of.
    const helperSeesPosterSent = await selectAs(request, helperHeaders, `messages?sender_id=eq.${posterId}&receiver_id=neq.${helperId}&select=id,content&limit=1`);
    expect(helperSeesPosterSent, "SECURITY: helper read messages it was not a party to").toEqual([]);
  });

  test("a user cannot write another account's profile", async ({ request }) => {
    const r = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${posterId}`, {
      headers: { ...helperHeaders, Prefer: "return=representation" },
      data: { full_name: "hijacked-by-t7" },
    });
    const body = r.ok() ? await r.json() : [];
    expect(Array.isArray(body) ? body : [], "SECURITY: helper wrote the poster's profile via IDOR").toEqual([]);
  });

  test("reviewing without a completed job is refused (reviews INSERT with_check)", async ({ request }) => {
    // The target job is open/unfunded — not completed — so the poster cannot
    // review the helper on it. Expect a policy rejection (403/401), never a row.
    const r = await request.post(`${SUPABASE_URL}/rest/v1/reviews`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: targetJobId, reviewer_id: posterId, reviewee_id: helperId, rating: 5, feedback: `${E2E_TITLE_MARKER} illegal review` },
    });
    expect(r.ok(), `SECURITY: a review was accepted for a non-completed job (status ${r.status()})`).toBe(false);
  });

  test("reviewing yourself is refused (reviewee must be the other party)", async ({ request }) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/reviews`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: targetJobId, reviewer_id: posterId, reviewee_id: posterId, rating: 5, feedback: `${E2E_TITLE_MARKER} self review` },
    });
    expect(r.ok(), `SECURITY: a self-review was accepted (status ${r.status()})`).toBe(false);
  });

  test("applying to your own job is refused", async ({ request }) => {
    // applications INSERT with_check pins helper_id = auth.uid() and job_is_funded,
    // and enforce_application_job_state runs BEFORE INSERT. The poster is the
    // job's customer; applying to it as a helper is disintermediation and must be
    // refused. Recorded live because the RLS with_check alone does not name the
    // customer≠helper rule — a landed row here is a SECURITY finding.
    const r = await request.post(`${SUPABASE_URL}/rest/v1/applications`, {
      headers: { ...posterHeaders, Prefer: "return=representation" },
      data: { job_id: targetJobId, helper_id: posterId, status: "pending", message: `${E2E_TITLE_MARKER} self apply` },
    });
    const landed = r.ok() && Array.isArray(await r.json().catch(() => [])) && r.status() === 201;
    if (landed) {
      announceUncovered("SECURITY: self-application landed", `poster ${posterId} applied to own job ${targetJobId}`);
    }
    expect(r.ok(), `SECURITY: an application to one's own job was accepted (status ${r.status()})`).toBe(false);
  });

  test("a poster cannot raise price or fee on their own job by UPDATE (money lock)", async ({ request }) => {
    // trg_poster_jobs_money_lock + prevent_job_field_escalation. The client's own
    // UPDATE path must not be able to move money columns; the checkout/RPC path is
    // the only writer. A moved value here is a SECURITY (money) finding.
    for (const col of ["final_amount", "platform_fee_amount", "budget"] as const) {
      const before = (await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}&select=${col}`, { headers: posterHeaders }).then((x) => x.json()))[0]?.[col] ?? null;
      const r = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}`, {
        headers: { ...posterHeaders, Prefer: "return=representation" },
        data: { [col]: 99999 },
      });
      // budget IS a poster-editable field on an open unfunded job; final_amount /
      // platform_fee_amount are not. Assert the money columns specifically.
      if (col === "budget") continue;
      const after = (await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${targetJobId}&select=${col}`, { headers: posterHeaders }).then((x) => x.json()))[0]?.[col] ?? null;
      expect(after, `SECURITY(money): poster moved ${col} on their own job from ${before} to ${after} via a raw UPDATE (status ${r.status()})`).toBe(before);
    }
  });
});
