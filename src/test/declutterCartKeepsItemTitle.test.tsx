/**
 * A Declutter sale keeps its item's title after the listing is deleted, and ended cards say their price and the day
 * they ended (Declutter audit DC-18 + DB-19, 2026-10-30). The class: every function whose last-resort title is
 * "An item from a former member" must first read the title kept on the cart line, and use those words only when the
 * seller's account is gone; the trigger that keeps the title must fire on every insert and status change; and both
 * ended-card renderers (buyer's EndedLine, seller's EndedSaleRows) show the date. The behaviour runs in
 * src/test/pglite/declutterCartKeepsItemTitle.pglite.mjs (migration applied 3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          COALESCE(i.title, c.item_title, |          COALESCE(i.title, NULL::text,
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql | CASE WHEN c.seller_id IS NULL THEN 'An item from a former member' | CASE WHEN true THEN 'An item from a former member'
 * @mutate supabase/migrations/20261030131715_declutter_cart_keeps_item_title.sql |   NEW.item_title := COALESCE(v_title, NEW.item_title); |   NEW.item_title := NEW.item_title;
 * @mutate supabase/migrations/20261030131715_declutter_cart_keeps_item_title.sql |   BEFORE INSERT OR UPDATE OF item_id, status ON public.declutter_cart_items |   BEFORE UPDATE OF item_id ON public.declutter_cart_items
 * @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |          c.closed_at,  -- DC-18: when an ended line ended |          NULL::timestamptz,  -- DC-18: when an ended line ended
 * @mutate src/components/declutter/BuyingOrders.tsx | {endedOnPrefix(line.closed_at)}{endedWords(line)} | {endedWords(line)}
 * @mutate src/components/declutter/BuyingOrders.tsx | {itemPriceLabel(line.price_cents)}</span> | </span>
 * @mutate src/components/declutter/DeclutterEndedSales.tsx | {endedOnPrefix(l.closed_at)}{endedSaleWords(l)} | {endedSaleWords(l)}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { render } from "@testing-library/react";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { EndedLine } from "@/components/declutter/BuyingOrders";
import type { CartLine } from "@/lib/declutter/api";

const MIG = "supabase/migrations";

describe("a Declutter sale keeps its item's title (DC-18 + DB-19)", () => {
  it("every function that falls back to 'a former member' reads the kept title first, and says it only when the seller is gone", () => {
    const defs = effectiveDefs(MIG);
    const users = [...defs.entries()].filter(([, d]) => blankSqlComments(d.stmt).includes("An item from a former member"));
    expect(users.length).toBeGreaterThan(0);
    for (const [name, d] of users) {
      const body = blankSqlComments(d.stmt);
      expect(body, name).toMatch(/COALESCE\(\s*i\.title\s*,\s*c\.item_title\s*,/);
      expect(body, name).toMatch(/CASE WHEN c\.seller_id IS NULL THEN 'An item from a former member'/);
    }
    expect(users.map(([n]) => n)).toContain("declutter_my_cart");
  });

  it("the cart read returns the line's closed_at (and still DB-5's source last)", () => {
    const cart = newestFunction("declutter_my_cart");
    expect(cart.body).toMatch(/\bc\.closed_at\b/);
    const sql = blankSqlComments(readFileSync(`${MIG}/${cart.file}`, "utf8"));
    const heads = [...sql.matchAll(/FUNCTION public\.declutter_my_cart\(\)\s+RETURNS TABLE\s*\(([^)]*)\)/gi)];
    expect(heads.length).toBeGreaterThan(0);
    expect(heads[heads.length - 1][1]).toMatch(/\bclosed_at timestamp with time zone\b/);
  });

  it("the newest trigger keeps the title on every insert and status change, from declutter_items while it exists", () => {
    const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(1000);
    let trigger = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(`${MIG}/${f}`, "utf8"));
      for (const m of sql.matchAll(/CREATE TRIGGER declutter_cart_item_keep_title\s+([^;]+);/g)) trigger = m[1];
      if (/DROP TRIGGER (?:IF EXISTS )?declutter_cart_item_keep_title\b/.test(sql) && !/CREATE TRIGGER declutter_cart_item_keep_title\b/.test(sql)) trigger = "";
    }
    expect(trigger).toMatch(/^BEFORE INSERT OR UPDATE OF item_id, status ON public\.declutter_cart_items\s+FOR EACH ROW/);
    const fn = blankSqlComments(newestFunction("declutter_cart_item_keep_title").body);
    expect(fn).toMatch(/SELECT i\.title INTO v_title FROM public\.declutter_items i WHERE i\.id = NEW\.item_id/);
    expect(fn).toMatch(/NEW\.item_title := COALESCE\(v_title, NEW\.item_title\)/);
  });

  const line: CartLine = {
    line_id: "l1", item_id: null, item_title: "Oak chair", my_side: "buyer", seller_id: "s1", price_cents: 4000,
    status: "cancelled_by_seller", checkout_by: "2026-10-27T00:00:00Z", order_id: null, order_status: null, handover: null,
    premium_cents: null, total_cents: null, porch_ok: false, closed_at: "2026-10-29T17:00:00Z",
  };
  const day = new Date("2026-10-29T17:00:00Z").toLocaleDateString([], { month: "short", day: "numeric" }).replace(/ /g, " ");

  it("the buyer's ended card shows the price and the day it ended", () => {
    const { container, unmount } = render(<ul><EndedLine line={line} /></ul>);
    const text = container.textContent ?? "";
    unmount();
    expect(text).toContain("Oak chair");
    expect(text).toContain("$40");
    expect(text).toContain(`${day} · The seller called off the sale.`);
  });

  it("the seller's ended row puts the same date before its words (it already showed the price)", () => {
    // Read, not rendered here: sellingDash.test.tsx (A2-20) renders these rows through the Selling dash.
    const src = blankComments(readFileSync("src/components/declutter/DeclutterEndedSales.tsx", "utf8"));
    expect(src).toContain("{endedOnPrefix(l.closed_at)}{endedSaleWords(l)}");
    expect(src).toContain("{itemPriceLabel(l.price_cents)}");
  });

  it("before the closed_at column is deployed, the cards still read (no date, no 'Invalid Date')", () => {
    const { container, unmount } = render(<ul><EndedLine line={{ ...line, closed_at: undefined }} /></ul>);
    const text = container.textContent ?? "";
    unmount();
    expect(text).toContain("The seller called off the sale.");
    expect(text).not.toMatch(/Invalid|·/);
  });
});
