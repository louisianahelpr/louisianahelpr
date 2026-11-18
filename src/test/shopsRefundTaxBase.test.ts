/**
 * Q2111 cash layer (20261118060158_shops_refund_tax_on_taxed_base.sql, Shops launch pass 2, 2026-11-18): a Shops
 * keep-card-fee refund keeps the tax on the kept fee at tax / (items + buyer fee), never counting the untaxed
 * delivery (shop-checkout sends "Shop delivery" / "Helpr delivery" as a non-taxable line).
 *
 * Behaviour proof: src/test/pglite/shopsRefundTaxBase.pglite.mjs (8 PASS; NEW_MIGRATION=skip 2 FAIL on the item's
 * worked example; planted: base without "- delivery" 3 FAIL, floor for ceil 6 FAIL, delivery share 0 3 FAIL;
 * measured 2026-11-18). This file keeps the newest bodies wired the same way.
 */
// @mutate supabase/migrations/20261118060158_shops_refund_tax_on_taxed_base.sql | CASE WHEN p.paid - p.tax - p.delivery > 0 THEN p.paid - p.tax - p.delivery END AS taxed_base | CASE WHEN p.paid - p.tax > 0 THEN p.paid - p.tax END AS taxed_base
// @mutate supabase/migrations/20261118060158_shops_refund_tax_on_taxed_base.sql | ELSE ceil(p_kept::numeric * p_tax / NULLIF(p_base, 0))::integer END; | ELSE floor(p_kept::numeric * p_tax / NULLIF(p_base, 0))::integer END;
// @mutate supabase/migrations/20261118060158_shops_refund_tax_on_taxed_base.sql | a.setup_fee_refund_cents, a.taxed_base_cents, | a.setup_fee_refund_cents, NULL,
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");

describe("Shops refunds keep tax on the taxed base, not on the delivery (Q2111)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of ["shop_refund_amounts", "shop_write_refund", "shop_refund_tax_kept_on_base"]) expect(DEFS.has(fn), fn).toBe(true);
    expect(body("shop_refund_amounts").length).toBeGreaterThan(1500);
  });

  it("the base is paid less tax less the delivery share, and the tax kept is read on it", () => {
    const amounts = body("shop_refund_amounts");
    expect(amounts).toMatch(/THEN\s+p\.paid\s*-\s*p\.tax\s*-\s*p\.delivery\s+END\s+AS\s+taxed_base/i);
    expect(amounts).toMatch(/ELSE\s+COALESCE\(so\.delivery_cents,\s*0\)\s+END\s+AS\s+delivery/i);
    expect(amounts).toMatch(/public\.shop_refund_tax_kept_on_base\(k\.kept,\s*k\.tax_cents,\s*k\.taxed_base\)/i);
    expect(body("shop_refund_tax_kept_on_base")).toMatch(/ceil\(p_kept::numeric\s*\*\s*p_tax\s*\/\s*NULLIF\(p_base,\s*0\)\)/i);
  });

  it("shop_write_refund stores the base, and the table CHECK reads it", () => {
    expect(body("shop_write_refund")).toMatch(/a\.setup_fee_refund_cents,\s*a\.taxed_base_cents,/i);
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, "20261118060158_shops_refund_tax_on_taxed_base.sql"), "utf8"));
    expect(mig).toMatch(/ELSE\s+public\.shop_refund_tax_kept_on_base\(kept_cents,\s*tax_cents,\s*taxed_base_cents\)\s+END\)/i);
  });
});
