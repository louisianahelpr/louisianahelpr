import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isLaborTaxable } from "@/lib/salesTax";

/**
 * The sales tax Stripe will actually charge, for the checkout quote.
 *
 * Replaces `useParishTaxRate`, which read a rate out of our own
 * `parish_tax_rates` table and multiplied it locally — a second implementation
 * of a number Stripe already computes at charge time via `automatic_tax`. The
 * two diverged: `parish_tax_rates` spelled two parishes "De Soto" and
 * "La Salle" while the ZIP table spelled them "DeSoto" and "LaSalle", the exact
 * lookup missed, and a miss read as a rate of ZERO — so seven ZIP codes were
 * quoted $0 on a charge Stripe then taxed at 10%.
 *
 * A quote that disagrees with the charge is worse than no quote (owner
 * decision 2026-08-23: "show Stripe's number, delete the table").
 *
 * RETURN CONTRACT — three states, deliberately distinct:
 *   number  the tax in DOLLARS. Exact; quote it as a real figure.
 *   0       a known zero — an exempt category. The total is exact.
 *   null    unknown: no address yet, the call failed, or it is still loading.
 *           Callers must show "+ tax" rather than invent a figure. This is the
 *           state the old code collapsed into 0, which is how a missing rate
 *           became a confident, wrong $0.
 */
export function useStripeSalesTax(
  budget: number,
  category: string | null | undefined,
  zip: string | null | undefined,
): { salesTax: number | null; loading: boolean; jurisdiction: string | null } {
  const [salesTax, setSalesTax] = useState<number | null>(null);
  const [jurisdiction, setJurisdiction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // An exempt category is a known zero and needs no round trip. Resolved from
    // the SAME module create-payment uses, so the two cannot disagree about
    // which categories are taxable.
    if (!isLaborTaxable(category)) {
      setSalesTax(0);
      setJurisdiction(null);
      setLoading(false);
      return;
    }
    if (!budget || budget <= 0 || !zip) {
      setSalesTax(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("calculate-tax", {
          body: { budget, category, zip, state: "LA" },
        });
        if (cancelled) return;
        if (error || typeof data?.taxCents !== "number") {
          // Unknown, NOT zero. The quote says "+ tax" and the payment sheet
          // shows the real figure.
          setSalesTax(null);
          setJurisdiction(null);
        } else {
          setSalesTax(data.taxCents / 100);
          setJurisdiction(data.jurisdiction ?? null);
        }
      } catch {
        if (!cancelled) {
          setSalesTax(null);
          setJurisdiction(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [budget, category, zip]);

  return { salesTax, loading, jurisdiction };
}
