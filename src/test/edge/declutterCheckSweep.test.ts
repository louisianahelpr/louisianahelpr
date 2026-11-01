/**
 * LEAD-CHECK-SWEEP (lead 10-31; owner rule: "everyday items must never be held just because a check didn't run").
 * The class: a posted listing is held for an admin only because its photo check never RAN (the app closed mid-bunch,
 * the tool was busy), or the server's way to run the missing check can be started by someone other than the service.
 *
 * Edge side, from the REAL declutter-ai-draft source through the edge harness:
 *   (a) mode check_sweep refuses every caller but the service key (a member's JWT, the anon key, no header), before
 *       it claims anything; nothing in the request names an item or a seller;
 *   (b) the service key runs the claim and records each verdict with the seller FROM THE CLAIMED ROW;
 *   (c) a failed claim is loud (500), a failed check records nothing (the try is already counted).
 * SQL side, read from the NEWEST definitions (behaviour: src/test/pglite/declutterCheckSweep.pglite.mjs, 25 PASS
 * after; NEW_MIGRATION=skip 19 FAIL, measured 2026-10-31):
 *   (d) the fail-safe holds an unchecked listing only after 3 failed tries, or a flag;
 *   (e) the claim is service-only, skips test data, and pg_cron calls it every 5 minutes.
 *
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     verify: verifyCronSecret, |     verify: () => null,
 * @mutate supabase/functions/declutter-ai-draft/checkSweep.ts |     if (refused) return refused; |     if (false) return refused;
 * @mutate supabase/functions/declutter-ai-draft/checkSweep.ts |     return deps.fail("sweep_claim_failed"); |     return deps.answer({ claimed: 0 }, { count: 0 });
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     return "defect";\n  }\n  const answer | return "failed";\n  }\n  const answer
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     p_seller_id: claim.sellerId, |     p_seller_id: claim.itemId,
 * @mutate supabase/functions/declutter-ai-draft/checkSweep.ts |       if (outcome === "defect" \|\| outcome === "stale" \|\| outcome === "busy") { |       if (outcome === "defect" \|\| outcome === "stale") {
 * @mutate supabase/functions/declutter-ai-draft/checkSweep.ts |       if (outcome === "defect" \|\| outcome === "stale" \|\| outcome === "busy") { |       if (false) {
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     return answer.status === 429 \|\| answer.status >= 500 ? "busy" : "defect"; |     return answer.status === 429 \|\| answer.status >= 500 ? "failed" : "defect";
 * @mutate supabase/functions/declutter-ai-draft/checkSweep.ts |   if (at(0) === 0x89 && ascii(1, 4) === "PNG") return "image/png"; |   if (at(0) === 0x89 && ascii(1, 4) === "PNG") return "image/jpeg";
 * @mutate supabase/migrations/20261101031241_declutter_check_sweep.sql |                       AND ((pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3) OR pv.ai_flag_reason IS NOT NULL)) |                       AND (pv.ai_checked_at IS NULL OR pv.ai_flag_reason IS NOT NULL))
 * @mutate supabase/migrations/20261101031241_declutter_check_sweep.sql |        AND NOT public.is_test_subject(i.seller_id) |        AND true
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { newestFunction } from "../helpers/parityReaders";
import { imageMediaType } from "../../../supabase/functions/declutter-ai-draft/checkSweep";
import { blankSqlComments } from "../helpers/blankNonCode";

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const ITEM = "00000000-0000-4000-8000-000000000101";
const ITEM2 = "00000000-0000-4000-8000-000000000102";
const sql = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function sweep(headers: Record<string, string>, body: unknown = { mode: "check_sweep" }, env: Record<string, string> = {}) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", ...env });
  const fn = await loadEdgeFunction("declutter-ai-draft");
  const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-ai-draft", headers, body }));
  const text = await res.text();
  return { status: res.status, body: (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<string, unknown> };
}

beforeEach(() => {
  resetEnv();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => resetEnv());

describe("(a) only the service can start the check sweep", () => {
  it("a signed-in member's JWT is refused before anything is claimed", async () => {
    scenario.authUser = { id: SELLER, email: "seller@example.test" };
    const r = await sweep({ Authorization: "Bearer member-jwt" });
    expect(r.status).toBe(401);
    expect(rpcs("declutter_check_sweep_claim")).toHaveLength(0);
    expect(rpcs("declutter_record_ai_check")).toHaveLength(0);
  });

  it("the anon key, or no header at all, is refused too", async () => {
    for (const headers of [{ Authorization: "Bearer anon-key" }, {} as Record<string, string>]) {
      const r = await sweep(headers);
      expect(r.status).toBe(401);
    }
    expect(rpcs("declutter_check_sweep_claim")).toHaveLength(0);
  });
});

describe("(b, c) the service key runs the sweep; the seller comes from the claimed row", () => {
  it("claims a batch and answers what it did", async () => {
    scenario.rpc.declutter_check_sweep_claim = [];
    const r = await sweep({ Authorization: "Bearer service-key" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ claimed: 0, checked: 0, failed: 0 });
    expect(rpcs("declutter_check_sweep_claim")).toHaveLength(1);
    expect(rpcs("declutter_check_sweep_claim")[0].args).toEqual({ p_limit: 5 });
  });

  it("a claimed listing gone since the claim is skipped (stale), with no verdict and no defect", async () => {
    scenario.rpc.declutter_check_sweep_claim = [{ sweep_item_id: ITEM, sweep_seller_id: SELLER, sweep_attempt: 1 }];
    scenario.reads.declutter_items = { rows: [] };
    const r = await sweep({ Authorization: "Bearer service-key" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ claimed: 1, stale: 1, failed: 0, checked: 0, defects: 0 });
    expect(rpcs("declutter_record_ai_check")).toHaveLength(0);
    // The try is given back: nothing was learned about the listing.
    expect(rpcs("declutter_check_sweep_give_back").map((c) => c.args)).toEqual([{ p_item_id: ITEM }]);
  });

  it("our own breakage (no model key) is a cron defect: the run answers 500, never a quiet try", async () => {
    scenario.rpc.declutter_check_sweep_claim = [{ sweep_item_id: ITEM, sweep_seller_id: SELLER, sweep_attempt: 1 }];
    scenario.reads.declutter_items = { rows: [{ id: ITEM, title: "Oak chair", description: "Sturdy.", category: "furniture" }] };
    scenario.reads.declutter_item_photos = { rows: [{ id: "p1", storage_path: `${SELLER}/a.jpg` }] };
    scenario.storage.objects.add(`${SELLER}/a.jpg`);
    const r = await sweep({ Authorization: "Bearer service-key" });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ fn: "declutter-ai-draft", claimed: 1, defects: 1 });
    expect(rpcs("declutter_record_ai_check")).toHaveLength(0);
    // Our fault never uses up the listing's tries: it is given back, and the failed run pages instead.
    expect(rpcs("declutter_check_sweep_give_back").map((c) => c.args)).toEqual([{ p_item_id: ITEM }]);
  });

  it("a claimed listing is judged on every photo and recorded for the seller in the claimed row", async () => {
    scenario.rpc.declutter_check_sweep_claim = [{ sweep_item_id: ITEM, sweep_seller_id: SELLER, sweep_attempt: 2 }];
    scenario.reads.declutter_items = { rows: [{ id: ITEM, title: "Oak chair", description: "Sturdy.", category: "furniture" }] };
    scenario.reads.declutter_item_photos = { rows: [{ id: "p1", storage_path: `${SELLER}/a.jpg` }, { id: "p2", storage_path: `${SELLER}/b.jpg` }] };
    scenario.storage.objects.add(`${SELLER}/a.jpg`);
    scenario.storage.objects.add(`${SELLER}/b.jpg`);
    scenario.rpc.declutter_record_ai_check = "2026-10-31T22:00:00Z";
    const verdict = { title: "Oak chair", description: "A chair.", category: "furniture", delivery_size: "small", condition_stars: 4,
      possibly_banned: false, banned_reason: "", price_dollars: 40, price_reason: "Solid wood." };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(verdict) }] }), { status: 200 })));
    try {
      const r = await sweep({ Authorization: "Bearer service-key" }, undefined, { ANTHROPIC_API_KEY: "sk-ant-test" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ claimed: 1, checked: 1, failed: 0 });
      const rec = rpcs("declutter_record_ai_check");
      expect(rec).toHaveLength(1);
      expect(rec[0].args).toMatchObject({ p_item_id: ITEM, p_seller_id: SELLER, p_judged_photo_ids: ["p1", "p2"], p_flag_reason: null });
      expect(rpcs("declutter_check_sweep_give_back")).toHaveLength(0);
      // The photo's own bytes are a JPEG (the storage double), so the model is told image/jpeg.
      const call = vi.mocked(fetch).mock.calls[0] as unknown as [unknown, { body?: unknown }];
      expect(String(call[1]?.body)).toContain('"media_type":"image/jpeg"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the model busy or down (429/5xx) gives every try back and pages once per run", async () => {
    scenario.rpc.declutter_check_sweep_claim = [
      { sweep_item_id: ITEM, sweep_seller_id: SELLER, sweep_attempt: 2 },
      { sweep_item_id: ITEM2, sweep_seller_id: SELLER, sweep_attempt: 1 },
    ];
    scenario.reads.declutter_items = { rows: [{ id: ITEM, title: "Oak chair", description: "Sturdy.", category: "furniture" }] };
    scenario.reads.declutter_item_photos = { rows: [{ id: "p1", storage_path: `${SELLER}/a.jpg` }] };
    scenario.storage.objects.add(`${SELLER}/a.jpg`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    try {
      const r = await sweep({ Authorization: "Bearer service-key" }, undefined, { ANTHROPIC_API_KEY: "sk-ant-test" });
      expect(r.status).toBe(500);
      expect(r.body).toMatchObject({ claimed: 2, busy: 2, failed: 0, defects: 1 });
      expect(rpcs("declutter_check_sweep_give_back")).toHaveLength(2);
      expect(rpcs("declutter_record_ai_check")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("each photo is sent as its real type (never every one as a JPEG)", () => {
    const b = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)]);
    const s = (t: string) => [...t].map((c) => c.charCodeAt(0));
    expect(imageMediaType(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(imageMediaType(b(0x89, ...s("PNG")))).toBe("image/png");
    expect(imageMediaType(b(...s("GIF89a")))).toBe("image/gif");
    expect(imageMediaType(b(...s("RIFF"), 0, 0, 0, 0, ...s("WEBP")))).toBe("image/webp");
    // An iPhone HEIC is not a type the model reads: null, so the sweep asks Storage for a rendered copy first.
    expect(imageMediaType(b(0, 0, 0, 0x18, ...s("ftypheic")))).toBeNull();
  });

  it("a failed claim is loud (500), never a quiet empty run", async () => {
    scenario.rpcErrors = { declutter_check_sweep_claim: { message: "connection reset", code: "08006" } };
    const r = await sweep({ Authorization: "Bearer service-key" });
    expect(r.status).toBe(500);
  });

  it("a member's own check (mode check) still goes to the member path", async () => {
    scenario.authUser = null;
    const r = await sweep({ Authorization: "Bearer member-jwt" }, { mode: "check", itemId: ITEM });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "not_authenticated" });
    expect(rpcs("declutter_check_sweep_claim")).toHaveLength(0);
  });
});

describe("(d, e) the SQL, newest definitions", () => {
  it("reads the newest definitions (floor)", () => {
    for (const n of ["declutter_hold_unchecked_listings", "declutter_check_sweep_claim"]) {
      expect(newestFunction(n).file, n).toContain("20261101031241");
    }
  });

  it("the fail-safe holds an unchecked listing only after 3 failed tries, or a flag", () => {
    const hold = sql("declutter_hold_unchecked_listings");
    expect(hold).toContain("((pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3) OR pv.ai_flag_reason IS NOT NULL)");
    expect(hold).toContain("pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3) FOR UPDATE OF i SKIP LOCKED");
    expect(hold).not.toContain("(pv.ai_checked_at IS NULL OR pv.ai_flag_reason IS NOT NULL)");
  });

  it("the claim skips test data and an admin's approval, and counts the try before it runs", () => {
    const claim = sql("declutter_check_sweep_claim");
    expect(claim).toContain("AND NOT i.is_seed AND NOT public.is_test_subject(i.seller_id)");
    expect(claim).toContain("AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)");
    expect(claim).toContain("SET ai_check_attempts = ai_check_attempts + 1");
    expect(claim).toContain("pv.ai_check_attempts < 3");
  });
});
