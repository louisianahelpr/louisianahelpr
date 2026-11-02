/**
 * Q2293 / Q2294: a refusal the app already shows in its own words is not
 * reported to Sentry from the MutationCache.
 *
 * Measured on prod (read-only SQL, Builder 4, 2026-11-02): ledger
 * 104294997a13 ("RentalsCopyError: Verify your ID first ...", Sentry
 * JAVASCRIPT-3T, last event 2026-10-19 02:07Z) and 8f84bf1e767f ("Error:
 * invalid_name", Sentry JAVASCRIPT-3V, last event 2026-10-19 04:30Z). Both came
 * through MutationCache.onError -> reportCacheError. 025f9e37dc (2026-10-19
 * 11:29Z) skips a worded RentalsCopyError and a shop error carrying
 * userMessage; neither issue has had an event since. queryClient.test.ts pins
 * the predicate only; this pins the WIRING with the real error classes.
 */
// @mutate src/lib/queryClient.ts | if (_isHandledCopyError(error)) return; | if (false) return;
import { afterEach, describe, expect, it, vi } from "vitest";

const reportSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errorLogger", () => ({ report: reportSpy }));

import { queryClient } from "@/lib/queryClient";
import { RentalsCopyError } from "@/lib/rentals/copy";
import { RENTALS_ERROR_COPY } from "@/lib/rentals/errorCopy";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";

const runFailingMutation = async (err: unknown) => {
  const m = queryClient.getMutationCache().build(queryClient, {
    mutationKey: ["q2293"],
    mutationFn: async () => {
      throw err;
    },
    retry: false,
  });
  await m.execute(undefined).catch(() => undefined);
};

afterEach(() => {
  reportSpy.mockClear();
  queryClient.getMutationCache().clear();
});

describe("Q2293/Q2294: worded refusals are not reported from the MutationCache", () => {
  it("a worded RentalsCopyError (identity_not_verified) is not reported", async () => {
    const words = RENTALS_ERROR_COPY.identity_not_verified;
    expect(words.length).toBeGreaterThan(10);
    await runFailingMutation(new RentalsCopyError(words, { message: "identity_not_verified", code: "42501" }));
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("a shop refusal carrying userMessage (invalid_name, the shape src/lib/shops/api.ts rpcData throws) is not reported", async () => {
    const words = SHOPS_ERROR_COPY.invalid_name;
    expect(words.length).toBeGreaterThan(10);
    await runFailingMutation(Object.assign(new Error("invalid_name"), { code: "P0001" }, { userMessage: words }));
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("an unworded failure still reports (the floor: the cache wiring is live)", async () => {
    await runFailingMutation(new RentalsCopyError(null, { message: "something_new" }));
    expect(reportSpy).toHaveBeenCalledTimes(1);
  });
});
