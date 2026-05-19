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
