/**
 * S045 (Shops audit 11-12): an unanswered custom order request lapses (wanted date passed or 7 days) and a quote past
 * its 7 days is stored expired, both told, by shop_custom_request_sweep (20261112091830; behaviour proof:
 * src/test/pglite/shopsCustomRequestLapse.pglite.mjs). This guard keeps the parts outside SQL wired: the money cron
 * calls the sweep in its own try, the sweep stays service_role only, and the list has words for 'lapsed'.
 *
 * @mutate supabase/functions/declutter-money/index.ts |     const custom = await admin.rpc("shop_custom_request_sweep", {}); |     const custom = { error: null, data: null };
 * @mutate src/components/shops/ShopCustomRequestsList.tsx |   lapsed: { buyer: "The shop didn't answer in time", shop: "Not answered in time" }, |
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const MIG = "supabase/migrations/";
const newest = (fn: string) =>
  readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => read(MIG + f).includes(`CREATE OR REPLACE FUNCTION public.${fn}(`));

describe("S045 custom requests lapse", () => {
  it("the money cron runs the sweep", () => {
    const src = read("supabase/functions/declutter-money/index.ts");
    expect(src).toContain('await admin.rpc("shop_custom_request_sweep", {})');
    expect(src).toMatch(/shop_custom_request_sweep failed/);
  });
  it("the sweep is service_role only and the table takes 'lapsed'", () => {
    const f = newest("shop_custom_request_sweep");
    expect(f).toBeTruthy();
    const sql = read(MIG + f);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.shop_custom_request_sweep\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.shop_custom_request_sweep\(\) TO service_role;/);
    expect(sql).toMatch(/status IN \('declined', 'withdrawn', 'lapsed'\)/);
  });
  it("the request list says what a lapsed request is, to both sides", () => {
    const src = read("src/components/shops/ShopCustomRequestsList.tsx");
    expect(src).toMatch(/lapsed: \{ buyer: "The shop didn't answer in time", shop: "Not answered in time" \}/);
  });
});
