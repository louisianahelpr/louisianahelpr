// Lead 11-01: instant book is switched off (migration 20261101164117); the three gated RPCs raise feature_disabled,
// and a stale tab or old app build must say so plainly instead of "Something went wrong".
// @mutate src/lib/lifecycleErrors.ts: remove the feature_disabled line under rpc_instant_book -> red
import { describe, expect, it } from "vitest";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

describe("instant book off has its own words", () => {
  for (const rpc of ["rpc_set_instant_book_floor", "instant_book_candidates", "rpc_instant_book"] as const) {
    it(`${rpc} explains feature_disabled`, () => {
      expect((RPC_ERROR_COPY[rpc] as Record<string, string>).feature_disabled).toBe("Instant book is turned off right now.");
    });
  }
});
