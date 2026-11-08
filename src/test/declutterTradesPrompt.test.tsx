/**
 * Owner decision 2026-11-08: trades were live but 0 of 265 live listings took them (the default is OFF). Two asks:
 *   (1) an "Open to trades?" row on the posting screen, below Condition, from the listing default, hidden when free;
 *   (2) a one-time "Turn on trades for all your listings?" card on the Selling tab, answered once per ACCOUNT
 *       (declutter_seller_defaults.trades_prompt_answered_at), Turn on through declutter_trades_prompt_answer.
 * Behaviour (real Postgres): src/test/pglite/declutterTradesPrompt.pglite.mjs (own rows only, anon and NULL caller
 * refused, open offers untouched). This guard pins the newest SQL definition and the client.
 *
 * @mutate supabase/migrations/20261108193632_declutter_trades_prompt.sql |      WHERE i.seller_id = v_uid |      WHERE true
 * @mutate supabase/migrations/20261108193632_declutter_trades_prompt.sql |     SET accepts_trades = d.accepts_trades OR p_turn_on, |     SET accepts_trades = p_turn_on,
 * @mutate supabase/migrations/20261108193632_declutter_trades_prompt.sql | REVOKE ALL ON FUNCTION public.declutter_trades_prompt_answer(boolean) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_trades_prompt_answer(boolean) FROM PUBLIC;
 * @mutate src/components/declutter/DeclutterTradesPrompt.tsx |   if (due.data !== true) return null; |   if (due.data === undefined) return null;
 * @mutate src/components/declutter/SellTradesRow.tsx |   if (form.free) return null; |
 * @mutate src/lib/declutter/tradesPrompt.ts |   if (row?.trades_prompt_answered_at) return false; |
 * @mutate src/components/declutter/useSellerDefaultsPrefill.ts |     setTradesWanted?.(row?.acceptsTrades === true); |     setTradesWanted?.(true);
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {only === null && <DeclutterTradesPrompt userId={userId} />}\n |
 * @mutate src/components/declutter/SellSummaryCard.tsx |         <SellTradesRow s={s} />\n |
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const db = {
  answered: null as string | null,
  offListings: [] as { id: string }[],
  filters: [] as string[],
  rpc: [] as [string, unknown][],
};

/** A chainable stand-in for the two table reads and the RPC fetchTradesPromptDue / answerTradesPrompt make. */
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      db.filters.push(`${table}.${name}(${args.map(String).join(",")})`);
      return b;
    };
    for (const m of ["select", "eq", "gt"]) b[m] = chain(m);
    b.maybeSingle = async () => ({ data: { trades_prompt_answered_at: db.answered }, error: null });
    b.limit = async () => ({ data: db.offListings, error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: async (name: string, args: unknown) => {
        db.rpc.push([name, args]);
        db.answered = "2026-11-08T12:00:00Z"; // the server keeps the answer
        return { data: 3, error: null };
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const { fetchTradesPromptDue } = await import("@/lib/declutter/tradesPrompt");
const { DeclutterTradesPrompt } = await import("@/components/declutter/DeclutterTradesPrompt");
const { SellTradesRow } = await import("@/components/declutter/SellTradesRow");

const src = (f: string) => blankComments(readFileSync(f, "utf8"));
const fnBody = (name: string): string => {
  const def = effectiveDefs("supabase/migrations").get(name);
  expect(def, `${name} is gone`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};

beforeEach(() => {
  db.answered = null;
  db.offListings = [{ id: "i1" }];
  db.filters = [];
  db.rpc = [];
});

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeclutterTradesPrompt userId="u1" />
    </QueryClientProvider>,
  );

describe("Declutter trades prompt (owner 11-08)", () => {
  it("the RPC turns on only the caller's live priced listings and never turns an on default off", () => {
    const b = fnBody("declutter_trades_prompt_answer");
    expect(b).toMatch(/PERFORM\s+public\.require_feature\('declutter'\)/i);
    expect(b).toMatch(/v_uid\s*:=\s*public\.declutter_assert_member\(true\)/i);
    expect(b).toMatch(/WHERE\s+i\.seller_id\s*=\s*v_uid\s+AND\s+i\.status\s*=\s*'live'\s+AND\s+i\.price_cents\s*>\s*0/i);
    expect(b).toMatch(/SET\s+accepts_trades\s*=\s*d\.accepts_trades\s+OR\s+p_turn_on/i);
    expect(b).toMatch(/VALUES\s*\(v_uid,/i);
    // Turning trades ON never voids offers (only OFF does, in declutter_set_trade_rules).
    expect(b).not.toMatch(/declutter_void_swaps/i);
    const sql = blankSqlComments(readFileSync("supabase/migrations/20261108193632_declutter_trades_prompt.sql", "utf8"));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.declutter_trades_prompt_answer\(boolean\) FROM PUBLIC, anon;/);
  });

  it("the card is due only when unanswered and a live priced listing is not open to trades", async () => {
    expect(await fetchTradesPromptDue("u1")).toBe(true);
    expect(db.filters).toEqual(expect.arrayContaining([
      "declutter_seller_defaults.eq(member_id,u1)",
      "declutter_items.eq(seller_id,u1)",
      "declutter_items.eq(status,live)",
      "declutter_items.gt(price_cents,0)",
      "declutter_items.eq(accepts_trades,false)",
    ]));
    db.answered = "2026-11-08T00:00:00Z";
    expect(await fetchTradesPromptDue("u1")).toBe(false);
    db.answered = null;
    db.offListings = [];
    expect(await fetchTradesPromptDue("u1")).toBe(false);
  });

  it("Turn on answers yes and the card goes; Not now answers no and the card goes", async () => {
    const first = renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitForElementToBeRemoved(() => screen.queryByText("Turn on trades for all your listings?")); // removed, not merely absent (waitForEmptyIsVacuous)
    expect(db.rpc).toEqual([["declutter_trades_prompt_answer", { p_turn_on: true }]]);
    first.unmount();
    db.answered = null;
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitForElementToBeRemoved(() => screen.queryByText("Turn on trades for all your listings?")); // removed, not merely absent (waitForEmptyIsVacuous)
    expect(db.rpc[1]).toEqual(["declutter_trades_prompt_answer", { p_turn_on: false }]);
  });

  it("no card once answered", async () => {
    db.answered = "2026-11-08T00:00:00Z";
    const { container } = renderCard();
    await waitFor(() => expect(db.filters.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-trades-prompt]")).toBeNull();
  });

  it("the posting row: on/off follows the form, hidden for a free listing", () => {
    const set = vi.fn();
    const form = { free: false } as Parameters<typeof SellTradesRow>[0]["s"]["form"];
    const { container, rerender } = render(<ul><SellTradesRow s={{ form, tradesWanted: false, setTradesWanted: set }} /></ul>);
    expect(screen.getByText("Buyers can offer one of their listings instead of cash")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Open to trades\?/ }));
    expect(set).toHaveBeenCalledWith(true);
    rerender(<ul><SellTradesRow s={{ form: { ...form, free: true }, tradesWanted: true, setTradesWanted: set }} /></ul>);
    expect(container.querySelector("[data-sell-trades]")).toBeNull();
  });

  it("wired in: below Condition, from the saved default, saved at Post, and the card on Selling", () => {
    const card = src("src/components/declutter/SellSummaryCard.tsx");
    expect(card.indexOf("<SellTradesRow s={s} />")).toBeGreaterThan(card.indexOf('title="Condition"'));
    expect(src("src/components/declutter/useSellerDefaultsPrefill.ts")).toMatch(/setTradesWanted\?\.\(row\?\.acceptsTrades === true\)/);
    expect(src("src/components/declutter/useSellerDefaultsPrefill.ts")).toMatch(/acceptsTrades: tradesWanted/);
    expect(src("src/components/declutter/DeclutterMineViews.tsx")).toMatch(/only === null && <DeclutterTradesPrompt userId=\{userId\} \/>/);
  });
});
