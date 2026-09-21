import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetStripeMock } from "./mocks/stripe";
import { resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

describe("edge harness smoke test", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("loads create-payment and its handler responds to OPTIONS", async () => {
    setEnv({ SUPABASE_URL: "https://x.test", SUPABASE_ANON_KEY: "anon" });
    const fn = await loadEdgeFunction("create-payment");
    const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
    expect(res.status).toBe(200);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// This is a META guard: its subject is the harness, so it is mutated against
// the harness. `serve` is the seam where a real edge function's handler is
// captured — half the functions reach it through this shim (create-payment
// imports `serve` from deno.land) and the other half through `Deno.serve`.
// Break it and no handler exists to drive, which is the one failure that would
// make EVERY harness-based guard in src/test/edge/ meaningless at once.
// @mutate src/test/edge/harness.ts | const serve = (h) => __hReg(h); | const serve = (h) => {};
