/**
 * ═══════════════════════════════════════════════════════════════════════════
 * "I'M ON MY WAY" IS NEVER OFFERED WITHOUT `helper_confirmed_at`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE BUG, FOUND LIVE (owner, 2026-09-19 — final browser gate). Prod job
 * bb2c3732-476a-4f66-aae6-372cbdfcfdf6: `status = 'in_progress'` with
 * `helper_confirmed_at`, `poster_confirmed_at` AND `helper_dayof_confirmed_at`
 * all NULL. The tracker painted the **Confirmed** step complete and offered
 * **"I'm On My Way"** — and the server refused the tap with
 * `helper_not_confirmed`.
 *
 * THE SERVER IS THE ORACLE. `helper_mark_on_the_way` (read live off prod
 * 2026-09-19, `pg_get_functiondef`) has exactly one content predicate:
 *
 *     IF v_job.helper_confirmed_at IS NULL THEN
 *       RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',
 *         HINT = 'Confirm the job before heading out.';
 *
 * `src/test/jobsGuardRpcParity.test.ts` pins that the client gate and the
 * migration still agree. This file pins the other half: that the RENDERED
 * card obeys it. The two are not the same check — the old code had the gate,
 * correct and readable, and still shipped the dead button, because the gate
 * was POSITIONAL: it lived inside the `job_confirmed` branch of the next-step
 * CTA, and `deriveCurrentStatusIdx` floored an `in_progress` job at Confirmed
 * on the STATUS alone, so `nextIdx` was already `on_the_way` and the branch
 * was never reached. A unit test of either piece passes; only mounting the
 * component in the reported state fails.
 *
 * SAME CLASS as the bad-GPS deadlock (`controlReachability.test.ts`): a
 * control offered for an action that will be refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTracking, deriveCurrentStatusIdx, STATUS_IDX } from "./JobTracking";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/TrackingMap", () => ({ TrackingMap: () => <div data-testid="tracking-map" /> }));
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({ request: async () => true }),
}));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ]) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  const written = { data: [{ id: "t-1" }], error: null };
  chain.then = (res: (v: typeof written) => unknown) => Promise.resolve(written).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

/** Today in the JOB's terms, so the two-hour action lock is never the reason
 *  a button is missing — this file is about the confirmation stamp alone. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function renderHelperTracker(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobTracking
          jobId="job-1"
          helperId="helper-1"
          isHelper
          isOwner={false}
          jobDateNeeded={TODAY}
          jobStartTime={null}
          jobStatus="in_progress"
          helperConfirmedAt={null}
          helperDayofConfirmedAt={null}
          posterConfirmedAt={null}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the reported prod row: in_progress with NO confirmation stamp", () => {
  it("does NOT offer the button the server refuses", () => {
    renderHelperTracker();
    expect(
      screen.queryByRole("button", { name: /I'm On My Way/i }),
      'the tracker offers "I\'m On My Way" on a job whose helper_confirmed_at is NULL. ' +
        "helper_mark_on_the_way raises helper_not_confirmed on exactly that row, so the tap " +
        "is refused — the bad-GPS deadlock's class, one step earlier on the same rail.",
    ).toBeNull();
  });

  it("points at the confirmation that IS theirs to give, once the rail is at Accepted", () => {
    // The poster's own confirmation puts the rail on Accepted without giving
    // the Helpr the stamp the server wants — the ordinary shape of this state,
    // and the one the "Confirm the job below" line was written for.
    renderHelperTracker({ posterConfirmedAt: "2026-09-19T15:00:00.000Z" });
    expect(screen.queryByRole("button", { name: /I'm On My Way/i })).toBeNull();
    expect(document.body.textContent ?? "").toMatch(/Confirm the job below to unlock the next step/i);
  });

  /* REPORT, NOT FIXED — the residual on this exact row, for the owner's
   * separate decision about how a job reaches `in_progress` with no stamps.
   *
   * With every confirmation stamp NULL the rail floors at Offered, so the
   * next-step CTA becomes "I've Accepted" (`STATUSES[1]`). That tap is NOT
   * refused by the server — it writes `job_tracking.status = 'confirmed'` and
   * nothing else — but it does not stamp `helper_confirmed_at` either, so it
   * advances the RAIL without producing the fact the next step needs, and the
   * card then lands on "Confirm the job below", whose control
   * (`JobConfirmation`) writes `helper_dayof_confirmed_at` — also not the
   * column `helper_mark_on_the_way` reads. No client tap can produce
   * `helper_confirmed_at`; only `accept_job` / `respond_to_direct_offer` do.
   *
   * It is left exactly as it is on purpose. Withholding "I've Accepted" here
   * would make that control unreachable in every state (it is only ever
   * offered when the helper has not confirmed), i.e. a deletion dressed as a
   * gate — and this lane's brief is to fix the control the SERVER refuses, not
   * to redesign the acceptance step. Every row in this state on prod today is
   * `is_seed = true`.
   */
  it("still offers no path that the server will refuse", () => {
    renderHelperTracker();
    const text = document.body.textContent ?? "";
    expect(text, "the only control here writes a tracking row, which the server accepts").toContain(
      "I've Accepted",
    );
    expect(screen.queryByRole("button", { name: /I'm On My Way/i })).toBeNull();
  });

  it("does not paint the Confirmed step complete off the status", () => {
    // The derivation, in the reported shape. `job_confirmed` is the rail's
    // "Confirmed" step; reaching it is what put the CTA on `on_the_way`.
    const idx = deriveCurrentStatusIdx({ jobStatus: "in_progress" });
    expect(
      idx,
      "deriveCurrentStatusIdx still reads jobs.status as a confirmation. " +
        "Confirmed is a STAMP fact (the mutual day-of pair), never a status fact.",
    ).toBeLessThan(STATUS_IDX.job_confirmed);
  });
});

describe("the gate keys on the STEP, not on where the rail happens to sit", () => {
  it("still withholds the button when the rail is dragged forward some other way", () => {
    // A stale `job_tracking` row parked on `job_confirmed` puts the rail one
    // step short of On the Way by a completely different route than the status
    // floor did. The old positional check would have been skipped here too.
    renderHelperTracker({
      initialTracking: {
        id: "t-1", status: "job_confirmed", latitude: null, longitude: null,
        eta_minutes: null, updated_at: "2026-09-19T15:00:00.000Z",
      },
    });
    expect(screen.queryByRole("button", { name: /I'm On My Way/i })).toBeNull();
  });

  it("offers it the moment the accept-time stamp exists — the client is never STRICTER", () => {
    // The server asks for `helper_confirmed_at` and nothing else: not the
    // poster's confirmation, not the day-of stamp. A poster who never confirms
    // must not be able to trap a helper on a job the server would start.
    renderHelperTracker({ helperConfirmedAt: "2026-09-19T15:00:00.000Z" });
    expect(screen.getByRole("button", { name: /I'm On My Way/i })).toBeTruthy();
  });
});

// The gate keys on the STEP THE BUTTON WOULD TAKE, not on where the rail sits.
// Narrowing it back to the `job_confirmed` step restores the positional form
// that shipped the dead button: any route that parks the rail on Confirmed
// (a stale job_tracking row, or the old status floor) walks straight past it.
// @mutate src/components/JobTracking.tsx | if (!helperHasConfirmed && (nextStatus.key === "job_confirmed" \|\| nextStatus.key === "on_the_way")) { | if (!helperHasConfirmed && nextStatus.key === "job_confirmed") {
