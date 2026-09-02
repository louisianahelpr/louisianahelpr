import { QueryClient, dehydrate, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryClient } from "./queryClient";

/**
 * These tests pin the ONE property that makes an offline write visible:
 * mutations must REJECT, not pause.
 *
 * React Query's default `networkMode: "online"` does not error when offline —
 * it parks the mutation. `mutationFn` never runs, `onError` never runs, and an
 * optimistic `onMutate` is left applied with nothing to undo it. Every write in
 * this app is optimistic, so the pause renders as a completed action that never
 * happened. Driven against prod on 2026-09-01 (same account, same job, same
 * offline procedure, prod vs the fixed build):
 *
 *   prod  +300ms  aria-label="Unsave job"  toasts=[]  netSinceTap=0
 *   fixed +300ms  aria-label="Save job"    toasts=["Couldn't save that job
 *                 right now — Tap retry to try again."]  netSinceTap=1
 *
 * The second block below is the regression guard proper: it reconstructs both
 * network modes against a real offline `onlineManager` and asserts the
 * difference in behaviour, so a future edit that drops `networkMode` from the
 * defaults fails here rather than in production silence.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("shared queryClient mutation defaults", () => {
  it("mutations are configured to fire and fail, never to pause", () => {
    const defaults = queryClient.getDefaultOptions().mutations;
    expect(defaults?.networkMode).toBe("always");
    // Explicit, not inherited from queries.retry — a write must never be
    // replayed automatically.
    expect(defaults?.retry).toBe(0);
  });

  it("queries are left on the default network mode (offline reads stay cached)", () => {
    // Only WRITES change. Queries keep TanStack's default so a cached read
    // still serves from the persisted cache while offline.
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBeUndefined();
  });
});

describe("networkMode semantics while offline", () => {
  beforeEach(() => onlineManager.setOnline(false));
  afterEach(() => onlineManager.setOnline(true));

  const makeClient = (networkMode: "online" | "always") =>
    new QueryClient({ defaultOptions: { mutations: { networkMode, retry: 0 } } });

  /** Mirrors the real shape of useSaveJob: optimistic apply + rollback. */
  const runToggle = async (client: QueryClient) => {
    const calls = { mutationFn: 0, onError: 0, rolledBack: false };
    let optimistic = true;
    const mutation = client
      .getMutationCache()
      .build<void, Error, void, { previous: boolean }>(client, {
        mutationFn: async () => {
          calls.mutationFn += 1;
          throw new TypeError("Failed to fetch");
        },
        onMutate: () => {
          const previous = optimistic;
          optimistic = false; // the heart flips instantly
          return { previous };
        },
        onError: (_e, _v, ctx) => {
          calls.onError += 1;
          if (ctx) {
            optimistic = ctx.previous;
            calls.rolledBack = true;
          }
        },
      });
    // A PAUSED mutation's promise never settles — it is parked until
    // `resumePausedMutations()`, which nothing in this app calls. Awaiting it
    // outright hangs the test, which is itself the point being asserted, so
    // race it against a short timer and inspect the state afterwards.
    await Promise.race([mutation.execute().catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
    await flush();
    return { calls, optimistic, isPaused: mutation.state.isPaused };
  };

  it('"online" (React Query default) PAUSES — no request, no error, no rollback', async () => {
    const client = makeClient("online");
    const { calls, optimistic, isPaused } = await runToggle(client);

    expect(isPaused).toBe(true);
    expect(calls.mutationFn).toBe(0); // nothing ever left the device
    expect(calls.onError).toBe(0); // the rollback handler is unreachable
    expect(calls.rolledBack).toBe(false);
    expect(optimistic).toBe(false); // heart still shows "saved" — a false success
  });

  it('"always" (this app) FIRES, rejects, rolls back and surfaces the failure', async () => {
    const client = makeClient("always");
    const { calls, optimistic, isPaused } = await runToggle(client);

    expect(isPaused).toBe(false);
    expect(calls.mutationFn).toBe(1); // the request was attempted
    expect(calls.onError).toBe(1); // onError runs -> errorToast + Retry
    expect(calls.rolledBack).toBe(true);
    expect(optimistic).toBe(true); // heart reverted to the truth
  });

  /**
   * The pause is not even ephemeral. `queryPersister` sets only
   * `shouldDehydrateQuery`, so TanStack's `defaultShouldDehydrateMutation`
   * applies — and it dehydrates exactly the mutations where `isPaused` is
   * true. Paused writes were therefore serialised into IndexedDB and restored
   * on next launch as zombies: nothing calls `resumePausedMutations()` and no
   * call site registers a `mutationKey` via `setMutationDefaults`, so a
   * restored mutation has no `mutationFn` and can never run.
   */
  it('"online" persists the paused write to disk as an unresumable zombie', async () => {
    const client = makeClient("online");
    await runToggle(client);
    expect(dehydrate(client).mutations).toHaveLength(1);
  });

  it('"always" leaves nothing to persist — no mutation is ever paused', async () => {
    const client = makeClient("always");
    await runToggle(client);
    expect(dehydrate(client).mutations).toHaveLength(0);
  });
});
