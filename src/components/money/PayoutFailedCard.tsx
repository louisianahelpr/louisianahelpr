import { Link } from "react-router-dom";
import { formatUsd } from "@/components/money/MoneyNote";
import { payoutFailureWords, useOpenPayoutFailures } from "@/components/money/payoutProblems";
import "@/lib/i18n/enMoneyTiles";
import { t } from "@/lib/i18n/language";

/**
 * Board 143, "Your payout didn't go through": the Home "Needs you" card while
 * a bank payout failure is open. Renders nothing otherwise (and nothing while
 * loading or on a read error: no card is better than a wrong one; the notice
 * the webhook sent still stands). Self-contained: Home mounts it as-is.
 *
 * Copy is what is true: Stripe returns a failed payout to the member's payout
 * balance, and it can't go out again until the bank is fixed. No promise of
 * when it is resent (payout timing is Stripe's schedule).
 */
export function PayoutFailedCard() {
  const { data } = useOpenPayoutFailures();
  const latest = data?.[0];
  if (!latest) return null;
  const words = payoutFailureWords(latest.failure_code);
  // More than one open failure: say so, rather than show one amount as if it
  // were the whole story (lh-money-escrow review, 2026-10-21).
  const more = (data?.length ?? 1) - 1;
  return (
    <div
      data-payout-failed-card=""
      className="rounded-2xl px-4 py-3"
      style={{ background: "hsl(var(--card))", border: "1.5px solid hsl(var(--destructive))" }}
    >
      <p className="flex items-center gap-1.5 text-ds-12 font-semibold" style={{ color: "hsl(var(--destructive-ink))" }}>
        <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: "hsl(var(--destructive))" }} />
        {t("mt.pf.needsYou")}
      </p>
      <p className="mt-1 font-sans font-bold text-ds-16 leading-snug text-foreground">{t("mt.pf.title")}</p>
      <p className="mt-1 text-ds-13 leading-snug text-muted-foreground">
        <span className="font-bold tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>{formatUsd(latest.amount_cents)}</span>{" "}
        {t("mt.pf.cameBack")}{more > 0 ? t(more === 1 ? "mt.pf.moreOne" : "mt.pf.moreMany", { n: more }) : ""}. {words ? `${words} ` : ""}{t("mt.pf.back")}
      </p>
      <Link
        to="/profile?tab=earnings"
        className="btn-grad-primary mt-3 inline-flex items-center justify-center h-11 px-5 rounded-full text-ds-13 font-bold"
      >
        {t("mt.pf.update")}
      </Link>
    </div>
  );
}
