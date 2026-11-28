import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { payoutAccountReady } from "@/lib/payoutAccountReady";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { payoutStatusWords } from "@/lib/declutter/payoutWords";
import { formatCents } from "./earningsTabHelpers";
import { salePayoutWords, type SalePayout } from "@/lib/declutter/salePayouts";

/**
 * A3-56: what Declutter paid the seller, in Money > Earned, one row per sale payout: "Sold: Oak rocking chair ·
 * $40.00 · Paid Oct 29" (or "Not sent yet" / "Didn't go through"). Newest first, every payout (the sold cards keep
 * about 30 days). Nothing when the member has sold nothing.
 */
export function DeclutterSalesEarned({ rows, failed, onRetry }: { rows: SalePayout[]; failed: boolean; onRetry: () => void }) {
  const { profile } = useCurrentUser();
  const payoutReady = payoutAccountReady(profile);
  const setupPaused = usePayoutSetupBlock() === "paused";
  if (failed) return <ErrorState variant="inline" title="We couldn't load your Declutter sales." onRetry={onRetry} />;
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl liquid-glass p-card" aria-labelledby="declutter-sales-earned">
      <h2 id="declutter-sales-earned" className="font-display font-bold leading-tight text-ds-17 mb-2" style={{ color: "hsl(var(--ink-deep))" }}>
        Declutter sales
      </h2>
      <ul className="divide-y divide-border/40">
        {rows.map((r) => (
          // Design audit r3 #31: two lines, the item then the amount and its state (one line cut the title to "Bar sto…").
          <li key={r.order_id} data-sale-payout={r.order_id} className="py-2 flex flex-col gap-0.5">
            {/* Area 06b M8 (design audit 11-18, display only): each row opens its sale on Selling, and a payout that did
                not go out says why, with the one place to fix it. The payout run and its rules are untouched. */}
            {/* Polish audit 11-27 #72: a 15px/600 row title with a chevron, no underline, its text centred in the 44px
                target so the amount sits right under it (the title sat at the top of the box with ~40px blank below). */}
            <Link to={`/declutter?tab=selling&order=${encodeURIComponent(r.order_id)}`} data-sale-payout-link=""
              className="flex min-h-11 min-w-0 items-center justify-between gap-2 text-ds-15 font-semibold no-underline [overflow-wrap:anywhere]" style={{ color: "hsl(var(--ink-deep))" }}>
              <span className="min-w-0">Sold: {r.title}</span>
              <ChevronRight className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden data-sale-payout-chevron="" />
            </Link>
            <span className="tabular-nums text-ds-13" style={{ color: r.status === "failed" ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.9)" }}>
              {formatCents(r.amount_cents)} · {salePayoutWords(r)}
            </span>
            {/* The why is the sale card's own payout words (payoutStatusWords, bound to the SQL), never a guessed cause;
                a pending payout with no ready payout account waits for it (20261019070737). Setup links hide while
                payout setup is paused for everyone. */}
            {(r.status === "failed" || (r.status === "pending" && !payoutReady)) && (
              <span className="text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.9)" }} data-sale-payout-why={r.status}>
                {r.status === "failed" ? payoutStatusWords(r) : "It goes out once your payout account is ready."}
                {!setupPaused && <>{" "}<Link to="/profile?tab=payment" className="font-semibold underline underline-offset-2" data-sale-payout-setup="">
                  {r.status === "failed" ? "Check your payouts" : "Set up payouts"}
                </Link></>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
