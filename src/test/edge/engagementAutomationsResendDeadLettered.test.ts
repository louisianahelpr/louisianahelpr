/**
 * The one-off re-send of dead-lettered welcome-drip emails (Q2479, audit E2-10).
 *
 * On 2026-10-27 26 welcome-drip emails passed the email queue's 60-minute limit
 * behind a 181-email backlog and were dead-lettered UNSENT, after
 * engagement-automations had already moved each member's drip_step past them.
 * The queue copies were cleared on 2026-10-29, so the only faithful re-send is
 * to render each again inside the function (same template, subject, sender and
 * the member's own signed unsubscribe link).
 *
 * What this pins, by running the REAL function source through the edge harness:
 *   - a `{ resend_dead_lettered: [...] }` POST runs ONLY the re-send: the daily
 *     drip cohort read never happens;
 *   - the step comes from the dead-lettered row, queued under the same label,
 *     with `resend_of` naming the lost message;
 *   - drip_step is never written; last_drip_at is (one drip email a day);
 *   - every consent gate of the daily drip is applied again, and a member who
 *     already has a later row for that step is skipped, so a second call sends
 *     nothing twice.
 */
// @mutate supabase/functions/engagement-automations/index.ts | if ((laterRows ?? []).length > 0) { skip('already_has_a_later_row'); continue } | if ((laterRows ?? []).length > 99) { skip('already_has_a_later_row'); continue }
// @mutate supabase/functions/engagement-automations/index.ts | if (person.marketing_consent !== true) { skip('no_marketing_consent'); continue } | if (person.marketing_consent === null) { skip('no_marketing_consent'); continue }
// @mutate supabase/functions/engagement-automations/index.ts | if (person.is_seed !== false) { skip('seed'); continue } | if (person.is_seed === null) { skip('seed'); continue }
// @mutate supabase/functions/engagement-automations/index.ts | if (suppressedSet.has(address)) { skip('suppressed'); continue } | if (false && suppressedSet.has(address)) { skip('suppressed'); continue }
// @mutate supabase/functions/engagement-automations/index.ts |           { last_drip_at: now.toISOString() },\n          'drip re-send', |           { drip_step: stepNo, last_drip_at: now.toISOString() },\n          'drip re-send',
// @mutate supabase/functions/engagement-automations/index.ts |           { resend_of: dead.message_id }, |           undefined,
// @mutate supabase/functions/engagement-automations/index.ts |     if (resendIds !== null) { |     if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders } from "./mocks/email";

const CRON_SECRET = "cron-secret";
const LOST_ID = "lost-msg-1";
const ADDRESS = "member_one@example.com";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("engagement-automations");
}

function resendRequest(fn: EdgeHarness, ids: unknown = [LOST_ID]) {
  return fn.request({
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    body: { resend_dead_lettered: ids },
  });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function queued() {
  return (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email");
}

type Person = Partial<{
  user_id: string;
  full_name: string | null;
  email: string | null;
  last_drip_at: string | null;
  email_verified: boolean | null;
  marketing_consent: boolean | null;
  is_seed: boolean | null;
  anonymized_at: string | null;
  ban_status: string | null;
}>;

/**
 * One dead-lettered step-2 row, no later row for it, and one eligible member.
 * `email_send_log` is read twice (the dead rows, then the later-row check), so
 * the dead-row read is told apart by its projection.
 */
function seed(opts: { person?: Person; laterRows?: Array<Record<string, unknown>>; template?: string } = {}) {
  scenario.reads.suppressed_emails = { rows: [] };
  scenario.reads.notification_preferences = { rows: [] };
  scenario.reads.come_back_email_sends = { rows: [] };
  scenario.reads.email_send_log = {
    rows: opts.laterRows ?? [],
    selectOverrides: [
      {
        includes: "template_name",
        result: {
          rows: [
            {
              message_id: LOST_ID,
              template_name: opts.template ?? "welcome_drip_step_2",
              recipient_email: ADDRESS,
              created_at: "2026-10-27T17:23:01Z",
            },
          ],
        },
      },
    ],
  };
  scenario.reads.profiles = {
    rows: [],
    selectOverrides: [
      {
        includes: "marketing_consent",
        result: {
          rows: [
            {
              user_id: "user-1",
              full_name: "Dana",
              email: ADDRESS,
              last_drip_at: "2026-10-24T16:22:00Z",
              email_verified: true,
              marketing_consent: true,
              is_seed: false,
              anonymized_at: null,
              ban_status: "active",
              ...(opts.person ?? {}),
            },
          ],
        },
      },
    ],
  };
}

describe("engagement-automations: re-send of dead-lettered welcome-drip steps", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
  });

  it("queues exactly the lost step, under its own label, and nothing from the daily run", async () => {
    const fn = await loadConfigured();
    seed();

    const res = await fn.fetch(resendRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.queued).toBe(1);
    expect(queued()).toHaveLength(1);
    expect((emailRenders[0] as { type: { name: string } }).type.name).toBe("WelcomeDripStep2Email");
    const payload = (queued()[0].args as { payload: Record<string, unknown> }).payload;
    expect(payload.label).toBe("welcome_drip_step_2");
    expect(payload.to).toBe(ADDRESS);

    // The send-log row says which lost message it replaces.
    const logInsert = scenario.writes.find((w) => w.table === "email_send_log" && w.op === "insert");
    expect(logInsert?.payload).toMatchObject({
      template_name: "welcome_drip_step_2",
      status: "pending",
      metadata: { resend_of: LOST_ID },
    });

    // drip_step is never moved; last_drip_at is stamped.
    const profileUpdates = scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
    expect(profileUpdates).toHaveLength(1);
    expect(Object.keys(profileUpdates[0].payload as object)).toEqual(["last_drip_at"]);

    // The daily drip cohort (the read that selects drip_step) never ran.
    const cohortReads = scenario.readQueries.filter((q) => q.table === "profiles" && q.cols.includes("drip_step"));
    expect(cohortReads).toHaveLength(0);
  });

  it("sends nothing twice: a later row for the same step skips the member", async () => {
    const fn = await loadConfigured();
    seed({ laterRows: [{ message_id: "already-resent" }] });

    const res = await fn.fetch(resendRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.queued).toBe(0);
    expect(b.skipped).toEqual({ already_has_a_later_row: 1 });
    expect(queued()).toHaveLength(0);
  });

  it.each([
    ["no_marketing_consent", { marketing_consent: false }],
    ["seed", { is_seed: true }],
    ["deleted", { anonymized_at: "2026-10-28T00:00:00Z" }],
    ["banned", { ban_status: "banned" }],
    ["unverified", { email_verified: false }],
    ["drip_email_in_20h", { last_drip_at: new Date(Date.now() - 3_600_000).toISOString() }],
    ["address_changed", { email: "someone_else@example.com" }],
  ] as const)("re-applies the daily drip's gates: %s is skipped", async (why, person) => {
    const fn = await loadConfigured();
    seed({ person });

    const res = await fn.fetch(resendRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.skipped).toEqual({ [why]: 1 });
    expect(queued()).toHaveLength(0);
  });

  it("honours the hard suppression list and the Promotions opt-out", async () => {
    const fn = await loadConfigured();
    seed();
    scenario.reads.suppressed_emails = { rows: [{ email: ADDRESS.toUpperCase() }] };
    const res = await fn.fetch(resendRequest(fn));
    expect((await body(res)).skipped).toEqual({ suppressed: 1 });

    resetSupabaseMock();
    resetEmailMocks();
    seed();
    scenario.reads.notification_preferences = { rows: [{ user_id: "user-1", email_promotions: false }] };
    const res2 = await fn.fetch(resendRequest(fn));
    expect((await body(res2)).skipped).toEqual({ opted_out: 1 });
    expect(queued()).toHaveLength(0);
  });

  it("refuses a row that is not a welcome-drip step", async () => {
    const fn = await loadConfigured();
    seed({ template: "admin_support_reply" });

    const res = await fn.fetch(resendRequest(fn));
    const b = await body(res);

    expect(b.skipped).toEqual({ not_a_welcome_drip_step: 1 });
    expect(queued()).toHaveLength(0);
  });

  it("rejects an empty or oversized id list with 400 and sends nothing", async () => {
    const fn = await loadConfigured();
    seed();
    expect((await fn.fetch(resendRequest(fn, []))).status).toBe(400);
    const many = Array.from({ length: 41 }, (_, i) => `id-${i}`);
    expect((await fn.fetch(resendRequest(fn, many))).status).toBe(400);
    expect(queued()).toHaveLength(0);
  });
});
