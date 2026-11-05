/**
 * Q1816 (db-drift-detect, nightly-red #4149, run 42105316708, 2026-11-05): the Supabase performance advisor read
 * no_primary_key 1 on prod, public.declutter_item_views (20261105163501), and the nightly check went red a day after
 * the migration landed. The same lint fired for declutter_item_price_drops (20261031224850; fixed by 20261105030137).
 * Class: every public table the migrations create has a primary key, read off the branch, so the next one is caught
 * on its own PR instead of by the nightly advisor.
 *
 * @mutate supabase/migrations/20261105232356_declutter_item_views_pk.sql |     ALTER TABLE public.declutter_item_views ADD CONSTRAINT declutter_item_views_pkey PRIMARY KEY (id); |     NULL;
 * @mutate supabase/migrations/20261105030137_fold_fee_debt_reads_price_drops_pk.sql |     ALTER TABLE public.declutter_item_price_drops ADD CONSTRAINT declutter_item_price_drops_pkey PRIMARY KEY (id); |     NULL;
 */
import { describe, expect, it } from "vitest";
import { tablesWithoutPrimaryKey } from "./helpers/tablesWithoutPrimaryKey";

describe("every public table has a primary key (advisor no_primary_key, Q1816 #4149)", () => {
  const { tables, missing } = tablesWithoutPrimaryKey();

  it("inventory: the migrations create the app's tables", () => {
    expect(tables).toBeGreaterThan(300);
  });

  it("no table is left without a primary key", () => {
    expect(missing).toEqual([]);
  });
});
