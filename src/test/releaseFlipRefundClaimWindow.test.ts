import { describe, it, expect, vi, afterEach } from "vitest";
import { flipJobToReleased } from "../../supabase/functions/_shared/releaseFlip";

/**
 * Q1324 (lh-money-escrow review of Q1290, 2026-10-05): a full admin refund
 * claims the job ('cancelling') before reading the payout ledger, sees the
 * payout's own claim row, refuses and puts the job back. A payout whose flip to
 * 'released' lands inside that window used to page a critical "split state".
 * The flip now re-reads a zero-row miss and waits out a 'cancelling' claim;
 * every other state still fails at once.
 *
 * @mutate supabase/functions/_shared/releaseFlip.ts |       if ((now as { payment_status?: string } \| null)?.payment_status === "cancelling") { |       if (false) {
 * @mutate supabase/functions/_shared/releaseFlip.ts |       if (rereadErr) { |       if (false) {
 */

/** A fake client: each update answers the next `flips` entry; each re-read the next `reads` entry. */
function fakeClient(flips: number[], reads: string[], readError: { message: string } | null = null) {
  let f = 0;
  let r = 0;
  const calls = { updates: 0, reads: 0 };
  const client = {
    from: (_t: string) => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: async () => {
              calls.updates++;
              const n = flips[Math.min(f++, flips.length - 1)];
              return { data: Array.from({ length: n }, () => ({ id: "job-1" })), error: null };
            },
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.reads++;
            if (readError) return { data: null, error: readError };
            return { data: { payment_status: reads[Math.min(r++, reads.length - 1)] }, error: null };
          },
        }),
      }),
    }),
  };
  return { client, calls };
}

describe("Q1324: the release flip waits out a refund claim's put-back", () => {
  afterEach(() => vi.useRealTimers());

  it("a miss while the job reads 'cancelling' is retried, and succeeds once the claim is put back", async () => {
    vi.useFakeTimers();
    const { client, calls } = fakeClient([0, 1], ["cancelling"]);
    const p = flipJobToReleased(client, "job-1");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    expect(calls.updates).toBe(2);
  });

  it("a miss on any other state (refunded) still fails at once, unretried", async () => {
    vi.useFakeTimers();
    const { client, calls } = fakeClient([0, 1], ["refunded"]);
    const p = flipJobToReleased(client, "job-1");
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.ok).toBe(false);
    expect(calls.updates).toBe(1);
  });

  it("a claim never put back still fails after the retries, naming the claim", async () => {
    vi.useFakeTimers();
    const { client, calls } = fakeClient([0], ["cancelling"]);
    const p = flipJobToReleased(client, "job-1");
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out).toMatchObject({ ok: false, zeroRow: true });
    expect((out as { message: string }).message).toMatch(/cancelling/);
    expect(calls.updates).toBe(4);
  });

  it("Q1341: a failed re-read is reported (not read as 'not cancelling' silently) and still fails at once", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient([0, 1], ["cancelling"], { message: "connection reset by peer" });
    const p = flipJobToReleased(client, "job-1");
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out).toMatchObject({ ok: false, zeroRow: true });
    expect((out as { message: string }).message).toMatch(/re-reading the job's payment_status failed: connection reset by peer/);
    expect(calls.updates).toBe(1);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("connection reset by peer"))).toBe(true);
    errSpy.mockRestore();
  });
});
