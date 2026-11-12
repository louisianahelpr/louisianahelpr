/**
 * Q2110: a member sees their own Shops strikes and when each ends; at the strike limit the screen says the day Shops opens again
 * (the soonest strike's end). The read is shops_my_strikes() (20261111011855): own active rows only, never
 * removed_by. Behaviour on a real database: src/test/pglite/shopsMyStrikes.pglite.mjs (3x, NEW_MIGRATION=skip red).
 *
 * @mutate src/components/shops/ShopMyStrikes.tsx | ? `Shops is paused for you until ${formatShortDate(rows[opensWith].expires_at)}` | ? "Shops is paused for you"
 * @mutate src/components/shops/ShopMyStrikes.tsx |   const opensWith = rows.length - SHOP_STRIKE_LIMIT; |   const opensWith = 0;
 * @mutate supabase/migrations/20261112083051_shops_strike_notice_words.sql |       CASE WHEN v_count < 3 |       CASE WHEN true
 * S046 (Shops audit 11-12): at 4 or more strikes the day is when enough have ended; the notice never reads "4 of 3".
 * @mutate src/components/shops/ShopMyStrikes.tsx |               {shopStrikeReasonWords(s.reason)}. Ends {formatShortDate(s.expires_at)}. |               {shopStrikeReasonWords(s.reason)}.
 * @mutate supabase/migrations/20261111011855_shops_my_strikes.sql |      WHERE s.user_id = v_uid |      WHERE true
 * @mutate supabase/migrations/20261111011855_shops_my_strikes.sql |     SELECT s.id, s.offender_side, s.reason, s.given_at, s.expires_at |     SELECT s.id, s.offender_side, s.reason, s.given_at, s.removed_by
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import ShopMyStrikes from "./ShopMyStrikes";
import { formatShortDate } from "@/lib/format";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const strike = (id: string, reason: string, ends: string) => ({ id, offender_side: "shop", reason, given_at: day(-1), expires_at: ends });
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShopMyStrikes /></QueryClientProvider>,
);

beforeEach(() => rpc.mockReset());

describe("a member's own Shops strikes (Q2110)", () => {
  it("lists each strike in plain words with the day it ends", async () => {
    rpc.mockResolvedValue({ data: [strike("a", "buyer_no_show", day(5)), strike("b", "shop_cancelled", day(80))], error: null });
    show();
    expect(await screen.findByText("You have 2 Shops strikes")).toBeTruthy();
    expect(screen.getByText(`You didn't pick up an order. Ends ${formatShortDate(day(5))}.`)).toBeTruthy();
    expect(screen.getByText(`Your shop cancelled an accepted order. Ends ${formatShortDate(day(80))}.`)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("shops_my_strikes");
  });

  it("at 3 strikes it says the day Shops opens again: the soonest end", async () => {
    rpc.mockResolvedValue({ data: [strike("a", "no_ready_photo", day(2)), strike("b", "admin_strike", day(9)), strike("c", "something_new", day(40))], error: null });
    show();
    expect(await screen.findByText(`Shops is paused for you until ${formatShortDate(day(2))}`)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(`A Shops order problem. Ends ${formatShortDate(day(40))}.`)).toBeTruthy();
  });

  it("S046: at 4 strikes the day Shops opens is when the second one ends", async () => {
    rpc.mockResolvedValue({ data: [strike("a", "no_ready_photo", day(2)), strike("b", "admin_strike", day(9)), strike("c", "buyer_no_show", day(40)), strike("d", "shop_cancelled", day(50))], error: null });
    show();
    expect(await screen.findByText(`Shops is paused for you until ${formatShortDate(day(9))}`)).toBeTruthy();
    expect(screen.getByText(/Shops opens again when 2 of them have ended\./)).toBeTruthy();
  });

  it("S046: the strike notice never reads 4 of 3 (newest shop_give_strike)", () => {
    const defs = effectiveDefs(resolve(__dirname, "../../../supabase/migrations"));
    const body = blankSqlComments(defs.get("shop_give_strike")?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain("CASE WHEN v_count < 3 THEN format('You got a Shops strike (%s of 3).");
    expect(body).toContain("ELSE format('You got a Shops strike. You now have %s, so Shops is closed for you until you are back under 3.");
  });

  it("shows nothing with no strikes or when the read fails", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const a = show();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(a.container.textContent).toBe("");
    a.unmount();
    rpc.mockResolvedValue({ data: null, error: { message: "feature_disabled", code: "42501" } });
    const b = show();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(b.container.textContent).toBe("");
  });

  it("the server read is the member's own active rows, never removed_by (newest definition)", () => {
    const defs = effectiveDefs(resolve(__dirname, "../../../supabase/migrations"));
    const def = defs.get("shops_my_strikes");
    expect(def?.file ?? "").toContain("shops_my_strikes");
    const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
    expect(body.length).toBeGreaterThan(300);
    expect(body).toContain("PERFORM public.require_feature('shops');");
    expect(body).toContain("WHERE s.user_id = v_uid AND s.removed_at IS NULL AND s.expires_at > now()");
    expect(body).not.toMatch(/removed_by|user_id uuid|p_user/);
    const file = readFileSync(resolve(__dirname, "../../../supabase/migrations", def!.file.split("/").pop()!), "utf8");
    expect(file).toContain("REVOKE ALL ON FUNCTION public.shops_my_strikes() FROM PUBLIC, anon;");
  });
});
