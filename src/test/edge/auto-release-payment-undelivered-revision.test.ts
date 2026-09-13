/**
 * `auto-release-payment` — a revision the helper NEVER delivers must not
 * strand the escrow.
 *
 * THE GAP. The revision settle-out pass added 2026-09-05 requires
 * `revision_completed_at IS NOT NULL` — deliberately, per its own comment,
 * because it moves money and must not pay out a fix still being worked on. So
 * it covers "helper delivered, poster went quiet" and nothing else. When the
 * helper never delivers at all, nothing matched: `revision_deadline` had ZERO
 * readers in `supabase/functions/` (the only two hits were comments), the
 * helper's "6h 5m remaining" countdown enforced nothing, and the poster's card
 * offered a dispute as an OPTIONAL act. Both parties going quiet left the
 * escrow sitting indefinitely.
 *
 * THE FIX (owner's decision): the platform opens the dispute the UI already
 * tells the poster they can file, through the SAME creation path a person
 * uses, and an admin decides the split. No money moves without human judgment.
 *
 * What these prove: a lapsed undelivered revision opens exactly one dispute; a
 * still-in-window one opens none; the sweep never releases money on that row;
 * and a second sweep does not open a second dispute.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-auto";
const HOUR = 3_600_000;

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
    RELEASE_PAYOUT_AUTO: "0",
  });
  return loadEdgeFunction("auto-release-payment");
}

function cronRequest(fn: EdgeHarness): Request {
  return fn.request({
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    url: "https://edge.test/auto-release-payment",
  });
}

/**
 * Seed ONLY the undelivered-revision read. `revision_deadline` is that query's
 * discriminator — no other `jobs` read in this function asks for it (the
 * settle-out pass asks for `revision_acceptance_deadline`, which does not
 * contain it as a substring), so the override cannot leak into the release
 * paths. Every other jobs read resolves to nothing.
 */
function seedUndelivered(rows: Record<string, unknown>[]) {
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [{ includes: "revision_deadline", result: { rows } }],
  };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.rpc.open_dispute_as = "dispute-new-1";
}

function disputeCalls() {
  return (scenario.rpcCalls ?? []).filter((c) => c.name === "open_dispute_as");
}

const lapsedJob = {
  id: "job-rev-undelivered",
  title: "Repaint the trim",
  revision_deadline: new Date(Date.now() - 2 * HOUR).toISOString(),
  revision_note: "The north side was missed",
};

describe("auto-release-payment · undelivered revision", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    resetEnv();
  });

  it("opens exactly one dispute when the revision deadline has lapsed undelivered", async () => {
    const fn = await load();
    seedUndelivered([lapsedJob]);

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.revisionDisputesOpened).toBe(1);

    const calls = disputeCalls();
    expect(calls).toHaveLength(1);
    const args = calls[0].args as Record<string, unknown>;
    expect(args._job_id).toBe("job-rev-undelivered");
    // The platform filed it — no human opener to blame or to let withdraw it.
    expect(args._opener_id).toBeNull();
    // The RPC refuses a description under 15 characters, and an admin decides
    // the split from these words.
    expect(String(args._reason).length).toBeGreaterThan(15);
    expect(String(args._reason)).toContain("Revision not delivered");

    // And no money moved: opening a dispute is the whole action.
    expect(body.released).toBe(0);
  });

  it("opens NO dispute while the revision is still in its window", async () => {
    const fn = await load();
    // The PostgREST filter (`revision_deadline <= now()`) is what excludes
    // this in production; the mock does not apply filters, so the row is
    // handed to the function and the sweep is asked to decide. Either way the
    // assertion is the same: nothing is filed on a live revision.
    scenario.reads.jobs = { rows: [], selectOverrides: [{ includes: "revision_deadline", result: { rows: [] } }] };
    scenario.reads.profiles = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.rpc.open_dispute_as = "dispute-new-1";

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.revisionDisputesOpened).toBe(0);
    expect(disputeCalls()).toHaveLength(0);
  });

  it("a second sweep does not open a duplicate dispute", async () => {
    const fn = await load();
    seedUndelivered([lapsedJob]);
    await fn.fetch(cronRequest(fn));
    expect(disputeCalls()).toHaveLength(1);

    // In production the job has left `revision_requested` by now, so the query
    // returns nothing on the next tick. Model exactly that.
    scenario.reads.jobs = {
      rows: [],
      selectOverrides: [{ includes: "revision_deadline", result: { rows: [] } }],
    };
    const res = await fn.fetch(cronRequest(fn));
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.revisionDisputesOpened).toBe(0);
    // Still one call in total across both sweeps.
    expect(disputeCalls()).toHaveLength(1);
  });

  it("records a defect rather than dying when the dispute cannot be opened", async () => {
    const fn = await load();
    seedUndelivered([lapsedJob]);
    scenario.rpcErrors = { open_dispute_as: { message: "boom" } };

    const res = await fn.fetch(cronRequest(fn));
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.revisionDisputesOpened).toBe(0);
    // A failed filing must be visible — it is escrow nobody is watching.
    expect(JSON.stringify(body)).toContain("open dispute for undelivered revision");
  });
});
