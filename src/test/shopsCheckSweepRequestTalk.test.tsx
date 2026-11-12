/**
 * Shops audit 2 (11-12), migration 20261112223654_shops_check_sweep_request_talk.sql:
 *   S2-001: a live shop item whose AI photo check never answered is checked by the server sweep (the existing
 *           declutter-check-sweep run claims shop items too, judges them like the editor, fails closed) and held for an
 *           admin after 3 failed tries. Behaviour on a real database: src/test/pglite/shopsCheckSweepRequestTalk.pglite.mjs
 *           (3x; NEW_MIGRATION=skip RED; 7 planted defects RED).
 *   S2-018: either side of an open custom request can message the other (the one shop chat, shops_open_request_talk).
 *
 * @mutate src/components/shops/ShopCustomRequestsList.tsx |       {OPEN.has(r.status) && openId !== r.id && <ShopOrderMessageButton requestId={r.id} side={side} />} |       {null}
 * @mutate src/components/shops/ShopTalk.tsx |     mutationFn: () => (requestId ? openShopRequestTalk(requestId) : openShopOrderTalk(orderId ?? "")), |     mutationFn: () => openShopOrderTalk(orderId ?? ""),
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const fetchMyCustomRequests = vi.fn();
vi.mock("@/lib/shops/customRequests", () => ({ fetchMyCustomRequests: () => fetchMyCustomRequests() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const talk = vi.hoisted(() => ({ request: vi.fn(async (_id: string) => "11111111-1111-4111-8111-111111111111"), order: vi.fn() }));
vi.mock("@/lib/shops/talk", async (io) => ({
  ...(await io<typeof import("@/lib/shops/talk")>()),
  openShopRequestTalk: (id: string) => talk.request(id),
  openShopOrderTalk: (id: string) => talk.order(id),
}));

import ShopCustomRequestsList from "@/components/shops/ShopCustomRequestsList";
import { rpcErrorMessage } from "@/lib/shops/rpcErrorCopy";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const SQL = read("supabase/migrations/20261112223654_shops_check_sweep_request_talk.sql");
const EDGE = read("supabase/functions/declutter-ai-draft/index.ts");

const base = { shop_id: "s1", shop_name: "TEST shop", wanted_date: null, payment_plan: "full_hold",
  quote_cents: null, quote_note: null, quoted_at: null, expires_at: null, created_at: "2026-11-10T15:00:00Z" };
const mount = (side: "buyer" | "shop") => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><ShopCustomRequestsList side={side} /></QueryClientProvider></MemoryRouter>);
};

describe("S2-018 a question about a custom request", () => {
  beforeEach(() => { fetchMyCustomRequests.mockReset(); talk.request.mockClear(); talk.order.mockClear(); });
  it("the shop messages the buyer from an open request (the request chat, not an order's)", async () => {
    fetchMyCustomRequests.mockResolvedValue([{ ...base, id: "r1", role: "shop", description: "A cake?", status: "requested" }]);
    mount("shop");
    fireEvent.click(await screen.findByRole("button", { name: /Message the buyer/ }));
    await waitFor(() => expect(talk.request).toHaveBeenCalledWith("r1"));
    expect(talk.order).not.toHaveBeenCalled();
  });
  it("the buyer messages the shop from a quoted request; a closed request has no button", async () => {
    fetchMyCustomRequests.mockResolvedValue([
      { ...base, id: "r2", role: "buyer", description: "Quoted", status: "quoted", quote_cents: 2000, quoted_at: base.created_at, expires_at: "2026-11-17T15:00:00Z" },
      { ...base, id: "r3", role: "buyer", description: "Closed", status: "declined" },
    ]);
    mount("buyer");
    expect(await screen.findAllByRole("button", { name: /Message the shop/ })).toHaveLength(1);
  });
  it("its refusals have words, and the server opens the ONE shop+member thread", () => {
    expect(rpcErrorMessage("shops_open_request_talk", { message: "request_not_found", code: "PT404" })).toBe(SHOPS_ERROR_COPY.request_not_found);
    expect(rpcErrorMessage("shops_open_request_talk", { message: "talk_blocked", code: "42501" })).toBe(SHOPS_ERROR_COPY.talk_blocked);
    expect(SQL).toMatch(/INSERT INTO public\.shop_talks \(shop_id, buyer_id\) VALUES \(q\.shop_id, q\.buyer_id\)\s+ON CONFLICT \(shop_id, buyer_id\) DO NOTHING/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.shops_open_request_talk(uuid) FROM PUBLIC, anon;");
  });
});

describe("S2-001 the server checks a shop item the editor never checked", () => {
  it("the sweep's claim and give-back are service role only, and the hold runs before the claim", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.shops_check_sweep_claim(integer) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.shops_check_sweep_claim(integer) TO service_role;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.shops_check_sweep_give_back(uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL.indexOf("pv.ai_check_attempts >= 3")).toBeLessThan(SQL.indexOf("pv.ai_check_attempts < 3"));
  });
  it("the cron's sweep claims shop items, judges them like the editor, records through the Shops RPC, fails closed", () => {
    expect(EDGE).toContain('service().rpc("shops_check_sweep_claim", { p_limit: limit })');
    expect(EDGE).toContain("judge: (claim) => (claim.shop ? sweepJudgeShop(service(), claim) : sweepJudge(service(), claim)),");
    expect(EDGE).toContain('claim.shop ? "shops_check_sweep_give_back" : "declutter_check_sweep_give_back"');
    const fn = EDGE.slice(EDGE.indexOf("async function sweepJudgeShop"), EDGE.indexOf("async function wantedCheck"));
    expect(fn).toContain('.eq("owner_id", claim.sellerId).eq("status", "live")');
    expect(fn).toContain("SHOP_ITEM_SYSTEM_PROMPT");
    expect(fn).toContain('admin.rpc("shops_record_item_ai_check"');
    expect(fn).toContain('const judged = answer.parsed ? sanitizeShopItemDraft(answer.parsed) : null;\n  if (!judged) return "failed";');
    expect(fn).toMatch(/if \(!answer\.ok\) \{[\s\S]{0,200}return answer\.status === 429 \|\| answer\.status >= 500 \? "busy" : "defect";/);
  });
});
