/**
 * Q1221 (owner decision 2026-10-05): a payout hold freezes the held Helpr's
 * Stripe AUTOMATIC payouts (Connect schedule -> manual) and the previous
 * schedule comes back when the hold lifts. Never silently: a pause that did
 * not happen and a restore that did not happen are both failures the caller
 * pages on, and nobody is left on manual with nothing remembering why.
 *
 * The state machine (_shared/payoutFreeze.ts) runs here against an in-memory
 * store and a FAKE Stripe client. No real connected account is touched.
 * The SQL half (triggers on payout_holds, the sweep) is proven by
 * src/test/pglite/payoutHoldFreezesStripePayouts.pglite.mjs; the edge wiring by
 * src/test/edge/payoutHoldStripeSync.test.ts.
 *
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (!(await store.savePrior(helperId, accountId, current))) continue; | void 0;
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (!saved \|\| saved.state !== "pause_requested" \|\| !saved.prior_schedule) continue; | if (!saved) continue;
 * @mutate supabase/functions/_shared/payoutFreeze.ts | let changed = false; | let changed = false; pausedHere = { accountId, prior: current, requestedAt: row.requested_at, attempt: 0 };
 * @mutate supabase/functions/_shared/payoutFreeze.ts | return `payout-freeze:${helperId}:${target}:${requestedAt}:a${attempt}`; | return `payout-freeze:${helperId}:${target}:${requestedAt}`;
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (current.interval !== "manual") {\n          await stripe.setSchedule | if (false) {\n          await stripe.setSchedule
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (await store.finishRestore(helperId)) {\n        return { kind: "restored" | if ((await store.finishRestore(helperId)) \|\| true) {\n        return { kind: "restored"
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (!stripe.isAccountGone(err)) throw err;\n          note = "the Connect account no longer exists; nothing to restore"; | note = "the Connect account no longer exists; nothing to restore";
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (pausedHere) {\n          // Our pause raced | if (false) {\n          // Our pause raced
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (prior.interval === "weekly" && prior.weekly_anchor) out.weekly_anchor = prior.weekly_anchor; |
 * @mutate supabase/functions/_shared/payoutFreeze.ts | attempts = await store.recordFailure(helperId, lastState, message); | attempts = 0;
 * @mutate supabase/functions/_shared/payoutFreeze.ts | if (current && current.interval !== "manual") { | if (false) {
 * @mutate supabase/functions/_shared/payoutFreeze.ts |           await store.markVerified(helperId);\n        }\n        return { kind: "paused", changed: pausedHere !== null }; |         }\n        return { kind: "paused", changed: pausedHere !== null };
 */
import { describe, expect, it } from "vitest";
import {
  type FreezeRow,
  type FreezeState,
  type FreezeStore,
  type PayoutSchedule,
  type StripeSchedulePort,
  reconcilePayoutFreeze,
  restorePayload,
} from "../../supabase/functions/_shared/payoutFreeze";

const H = "aaaaaaaa-0000-4000-8000-000000000001";
const ACCT = "acct_q1221";
const DAILY: PayoutSchedule = { interval: "daily", delay_days: 2 };

type Row = FreezeRow & { attempts: number; freeze_error: string | null; verified?: boolean };

/** The table, in memory, with the same compare-and-set semantics as supabaseFreezeStore. */
function memoryStore(init: Partial<Row> | null, account: string | null = ACCT) {
  let row: Row | null = init
    ? {
        helper_id: H,
        state: "pause_requested",
        stripe_account_id: null,
        prior_schedule: null,
        requested_by: "admin-1",
        requested_at: "2026-10-05T21:00:00.000Z",
        attempts: 0,
        freeze_error: null,
        ...init,
      }
    : null;
  const hooks = {
    beforeMarkPaused: null as null | (() => void),
    beforeSavePrior: null as null | (() => void),
    afterSavePrior: null as null | (() => void),
    markPausedThrows: null as Error | null,
  };
  const store: FreezeStore & { row: () => Row | null; set: (r: Row | null) => void; hooks: typeof hooks } = {
    hooks,
    row: () => row,
    set: (r) => {
      row = r;
    },
    async get() {
      return row ? { ...row } : null;
    },
    async accountIdOf() {
      return account;
    },
    async savePrior(_h, accountId, prior) {
      const hook = hooks.beforeSavePrior;
      hooks.beforeSavePrior = null;
      hook?.();
      if (row && row.state === "pause_requested" && row.prior_schedule === null) {
        row = { ...row, prior_schedule: prior, stripe_account_id: accountId };
        const after = hooks.afterSavePrior;
        hooks.afterSavePrior = null;
        after?.();
        return true;
      }
      return false;
    },
    async markPaused(_h, accountId) {
      const hook = hooks.beforeMarkPaused;
      hooks.beforeMarkPaused = null;
      hook?.();
      if (hooks.markPausedThrows) {
        const e = hooks.markPausedThrows;
        hooks.markPausedThrows = null;
        throw e;
      }
      if (!row || row.state !== "pause_requested") return false;
      row = { ...row, state: "paused", stripe_account_id: accountId, attempts: 0, freeze_error: null };
      return true;
    },
    async finishRestore() {
      if (!row || row.state !== "restore_requested") return false;
      row = null;
      return true;
    },
    async markVerified() {
      if (row && row.state === "paused") row = { ...row, verified: true };
    },
    async recordFailure(_h, state: FreezeState, message) {
      if (!row || row.state !== state) return 0;
      row = { ...row, attempts: row.attempts + 1, freeze_error: message };
      return row.attempts;
    },
  };
  return store;
}

/** A fake Stripe account: its schedule, every update, and failure switches. */
function fakeStripe(schedule: PayoutSchedule | null = DAILY) {
  const calls: Array<{ accountId: string; schedule: PayoutSchedule; key: string }> = [];
  /** Every key Stripe was SENT, failed attempts included. */
  const keysSent: string[] = [];
  const state = {
    schedule,
    failSet: null as Error | null,
    failRetrieve: null as Error | null,
    afterSet: null as null | (() => void),
  };
  const port: StripeSchedulePort & { calls: typeof calls; state: typeof state; keysSent: string[] } = {
    calls,
    keysSent,
    state,
    async retrieveSchedule() {
      if (state.failRetrieve) throw state.failRetrieve;
      return state.schedule ? { ...state.schedule } : null;
    },
    async setSchedule(accountId, s, key) {
      keysSent.push(key);
      if (state.failSet) throw state.failSet;
      calls.push({ accountId, schedule: s, key });
      state.schedule = { ...s };
      state.afterSet?.();
    },
    isAccountGone: (err) => /No such account/.test(String((err as Error)?.message)),
  };
  return port;
}

describe("Q1221: a payout hold freezes Stripe automatic payouts", () => {
  it("a hold sets the schedule to manual and remembers the daily schedule it replaced", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "paused", changed: true });
    expect(stripe.calls).toEqual([{ accountId: ACCT, schedule: { interval: "manual" }, key: expect.stringContaining(H) }]);
    expect(store.row()).toMatchObject({ state: "paused", stripe_account_id: ACCT, prior_schedule: DAILY });
  });

  it("a release puts the exact previous schedule back, then forgets the freeze", async () => {
    const store = memoryStore({ state: "restore_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "restored", changed: true });
    expect(stripe.calls.map((c) => c.schedule)).toEqual([{ interval: "daily", delay_days: 2 }]);
    expect(store.row()).toBeNull();
  });

  it("idempotent: a settled pause and a run with no row change nothing at Stripe", async () => {
    const paused = memoryStore({ state: "paused", stripe_account_id: ACCT, prior_schedule: DAILY });
    const s1 = fakeStripe({ interval: "manual" });
    expect(await reconcilePayoutFreeze(H, paused, s1)).toMatchObject({ kind: "paused", changed: false });
    const none = memoryStore(null);
    const s2 = fakeStripe();
    expect(await reconcilePayoutFreeze(H, none, s2)).toMatchObject({ kind: "nothing" });
    expect([...s1.calls, ...s2.calls]).toEqual([]);
  });

  it("a schedule that was already manual is remembered as manual and not re-sent", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe({ interval: "manual" });
    expect(await reconcilePayoutFreeze(H, store, stripe)).toMatchObject({ kind: "paused", changed: false });
    expect(stripe.calls).toEqual([]);
    expect(store.row()?.prior_schedule).toEqual({ interval: "manual" });
  });

  it("re-held before the restore ran: paused again, and the ORIGINAL schedule is still the one to restore", async () => {
    // The trigger turns restore_requested back into pause_requested and keeps prior_schedule.
    const store = memoryStore({ state: "pause_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    await reconcilePayoutFreeze(H, store, stripe);
    expect(store.row()).toMatchObject({ state: "paused", prior_schedule: DAILY });
  });

  it("a FAILED pause is a failure the caller pages on, counted on the row (never 'paused')", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    stripe.state.failSet = new Error("Stripe is down");

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "failed", state: "pause_requested", message: "Stripe is down", attempts: 1, requestedBy: "admin-1" });
    expect(store.row()).toMatchObject({ state: "pause_requested", attempts: 1, freeze_error: "Stripe is down" });
    // The schedule to restore was saved BEFORE Stripe was touched.
    expect(store.row()?.prior_schedule).toEqual(DAILY);
  });

  it("a FAILED restore keeps the row (so the Helpr is never left on manual and forgotten)", async () => {
    const store = memoryStore({ state: "restore_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    stripe.state.failSet = new Error("rate limited");

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "failed", state: "restore_requested", attempts: 1 });
    expect(store.row()).toMatchObject({ state: "restore_requested", prior_schedule: DAILY });
  });

  it("an unreadable schedule is a failure, not a pause", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    stripe.state.failRetrieve = new Error("timeout");
    expect(await reconcilePayoutFreeze(H, store, stripe)).toMatchObject({ kind: "failed", message: "timeout" });
    expect(stripe.calls).toEqual([]);
  });

  it("a release that lands WHILE the pause is in flight is undone with the schedule this run saw", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    // The admin releases right after Stripe took the pause: the trigger flips
    // the row to restore_requested before this run records the pause.
    stripe.state.afterSet = () => {
      stripe.state.afterSet = null;
      const r = store.row()!;
      store.set({ ...r, state: "restore_requested" });
    };

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "restored" });
    expect(stripe.calls.map((c) => c.schedule.interval)).toEqual(["manual", "daily"]);
    expect(stripe.state.schedule).toEqual({ interval: "daily", delay_days: 2 });
    expect(store.row()).toBeNull();
  });

  it("a release finished by ANOTHER run while ours paused: ours puts the schedule back itself", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    stripe.state.afterSet = () => {
      stripe.state.afterSet = null;
      store.set(null);
    };
    const out = await reconcilePayoutFreeze(H, store, stripe);
    expect(out).toMatchObject({ kind: "restored", changed: true });
    expect(stripe.state.schedule?.interval).toBe("daily");
  });

  it("a re-hold that lands WHILE a restore is in flight pauses again (the row is not dropped)", async () => {
    const store = memoryStore({ state: "restore_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    // The admin re-holds right after Stripe took the restore: the trigger turns
    // the row back into pause_requested (prior kept) before this run deletes it.
    stripe.state.afterSet = () => {
      stripe.state.afterSet = null;
      const r = store.row()!;
      store.set({ ...r, state: "pause_requested" });
    };

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(out).toMatchObject({ kind: "paused", changed: true });
    expect(stripe.calls.map((c) => c.schedule.interval)).toEqual(["daily", "manual"]);
    expect(store.row()).toMatchObject({ state: "paused", prior_schedule: DAILY });
  });

  it("a re-held Helpr whose release finishes elsewhere mid-run keeps the ORIGINAL schedule, never 'manual'", async () => {
    // Re-held before the restore ran: Stripe is still manual, the saved prior is daily.
    const store = memoryStore({ state: "pause_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    // Another run finishes a release (Stripe put back, row gone) before this run records the pause.
    store.hooks.beforeMarkPaused = () => {
      store.set(null);
      stripe.state.schedule = { ...DAILY };
    };

    await reconcilePayoutFreeze(H, store, stripe);

    // This run changed nothing at Stripe, so it has nothing to undo.
    expect(stripe.calls).toEqual([]);
    expect(stripe.state.schedule).toEqual(DAILY);
  });

  it("a release landing right after the prior is saved: nothing is set to manual first", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    store.hooks.afterSavePrior = () => store.set({ ...store.row()!, state: "restore_requested" });

    await reconcilePayoutFreeze(H, store, stripe);

    expect(stripe.calls.filter((c) => c.schedule.interval === "manual")).toEqual([]);
    expect(stripe.state.schedule).toEqual(DAILY);
    expect(store.row()).toBeNull();
  });

  // ── lh-money-escrow review of e9d056b39 (2026-10-05) ──────────────────────

  it("review 1: a release between the read and the save never leaves the Helpr on manual (even if the run then dies)", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    // The admin releases after this run read the row, before it saved the prior...
    store.hooks.beforeSavePrior = () => store.set({ ...store.row()!, state: "restore_requested" });
    // ...and the run dies right after its next DB write attempt.
    store.hooks.markPausedThrows = new Error("connection lost");

    await reconcilePayoutFreeze(H, store, stripe);
    // The 10-minute sweep runs the request again.
    await reconcilePayoutFreeze(H, store, stripe);

    expect(stripe.state.schedule, "the Helpr was left on manual payouts with nothing remembering why").toEqual(DAILY);
    expect(store.row()).toBeNull();
  });

  it("review 2: a run that loses the race to save the prior never writes 'manual' back as the schedule to restore", async () => {
    const store = memoryStore({ state: "pause_requested" });
    // Another run already set Stripe to manual...
    const stripe = fakeStripe({ interval: "manual" });
    // ...and saves the real prior just before this run tries to.
    store.hooks.beforeSavePrior = () =>
      store.set({ ...store.row()!, prior_schedule: DAILY, stripe_account_id: ACCT });
    // Then the hold is released and the restore finishes elsewhere.
    store.hooks.beforeMarkPaused = () => {
      store.set(null);
      stripe.state.schedule = { ...DAILY };
    };

    await reconcilePayoutFreeze(H, store, stripe);

    expect(stripe.state.schedule).toEqual(DAILY);
    expect(stripe.calls.filter((c) => c.schedule.interval === "manual")).toEqual([]);
  });

  it("review 3: a retry after a failed Stripe call uses a NEW idempotency key (no cached error replayed)", async () => {
    const store = memoryStore({ state: "pause_requested" });
    const stripe = fakeStripe(DAILY);
    stripe.state.failSet = new Error("Stripe 500");
    expect(await reconcilePayoutFreeze(H, store, stripe)).toMatchObject({ kind: "failed", attempts: 1 });
    stripe.state.failSet = null;
    expect(await reconcilePayoutFreeze(H, store, stripe)).toMatchObject({ kind: "paused" });

    expect(stripe.keysSent).toHaveLength(2);
    expect(stripe.keysSent[0]).not.toBe(stripe.keysSent[1]);
  });

  it("review 3: the same attempt keeps the same key (one intent stays idempotent)", async () => {
    const a = fakeStripe(DAILY);
    await reconcilePayoutFreeze(H, memoryStore({ state: "pause_requested" }), a);
    const b = fakeStripe(DAILY);
    await reconcilePayoutFreeze(H, memoryStore({ state: "pause_requested" }), b);
    expect(a.keysSent).toEqual(b.keysSent);
  });

  it("re-review: a restore that races a re-hold leaves Stripe manual (the row says paused and is checked)", async () => {
    // Run A is restoring; a re-hold lets run B mark the row paused (B saw
    // Stripe still manual). A's restore then sets daily and its delete fails.
    const store = memoryStore({ state: "restore_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    stripe.state.afterSet = () => {
      stripe.state.afterSet = null;
      store.set({ ...store.row()!, state: "paused" });
    };

    const out = await reconcilePayoutFreeze(H, store, stripe);

    expect(stripe.state.schedule?.interval, "the row says paused while Stripe pays out daily").toBe("manual");
    expect(out).toMatchObject({ kind: "paused", drifted: true });
    expect(store.row()).toMatchObject({ state: "paused", prior_schedule: DAILY });
  });

  it("a paused row whose Stripe schedule is really manual is left alone, and stamped verified", async () => {
    const store = memoryStore({ state: "paused", stripe_account_id: ACCT, prior_schedule: DAILY });
    const stripe = fakeStripe({ interval: "manual" });
    expect(await reconcilePayoutFreeze(H, store, stripe)).toMatchObject({ kind: "paused", changed: false });
    expect(stripe.calls).toEqual([]);
    expect(store.row()?.verified, "the 6-hourly re-check would never see it as checked").toBe(true);
  });

  it("no Connect account, or a deleted one: nothing can pay out, so the freeze is recorded with no Stripe call", async () => {
    const noAccount = memoryStore({ state: "pause_requested" }, null);
    const s1 = fakeStripe();
    expect(await reconcilePayoutFreeze(H, noAccount, s1)).toMatchObject({ kind: "paused", note: "no Connect account on file" });
    const gone = memoryStore({ state: "pause_requested" });
    const s2 = fakeStripe();
    s2.state.failRetrieve = new Error("No such account: 'acct_q1221'");
    expect(await reconcilePayoutFreeze(H, gone, s2)).toMatchObject({ kind: "paused" });
    expect([...s1.calls, ...s2.calls]).toEqual([]);
  });

  it("a restore whose account is gone, or that never paused, closes without a Stripe call", async () => {
    const gone = memoryStore({ state: "restore_requested", stripe_account_id: ACCT, prior_schedule: DAILY });
    const s1 = fakeStripe();
    s1.state.failSet = new Error("No such account: 'acct_q1221'");
    expect(await reconcilePayoutFreeze(H, gone, s1)).toMatchObject({ kind: "restored", changed: false });
    expect(gone.row()).toBeNull();
    const never = memoryStore({ state: "restore_requested" });
    const s2 = fakeStripe();
    expect(await reconcilePayoutFreeze(H, never, s2)).toMatchObject({ kind: "restored", note: "nothing was paused" });
    expect(s2.calls).toEqual([]);
  });

  it("restorePayload sends only what Stripe accepts for the interval", () => {
    expect(restorePayload({ interval: "weekly", delay_days: 3, weekly_anchor: "friday", monthly_anchor: 5 })).toEqual({
      interval: "weekly",
      delay_days: 3,
      weekly_anchor: "friday",
    });
    expect(restorePayload({ interval: "monthly", delay_days: 2, monthly_anchor: 15, weekly_anchor: "monday" })).toEqual({
      interval: "monthly",
      delay_days: 2,
      monthly_anchor: 15,
    });
    expect(restorePayload({ interval: "manual", delay_days: 2 })).toEqual({ interval: "manual" });
  });
});
