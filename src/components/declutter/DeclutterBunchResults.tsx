/**
 * What happened after listing on Sell a bunch (audit 10-30, finding 9: the result sat 1,108 px down on an 812 px screen
 * with focus nowhere). It opens at the top of the page and takes focus: what failed first, each with a way to fix it, then each
 * listing by name with its link, a way to share them and a way to list more.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPublicOrigin } from "@/lib/authRedirects";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import type { BunchOutcome } from "@/lib/declutter/bunch";
import { shareNative } from "@/lib/nativeShare";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { memberProfilePath } from "@/lib/profileLink/memberProfilePath";
import "@/lib/i18n/enListingParts";
import { t } from "@/lib/i18n/language";

/** A3-70: the Home screen's words for a listing the auto-check held (DeclutterHomeView). */
const beingChecked = () => t("lp.rs.notice");

type Listed = Extract<BunchOutcome, { status: string }>;
type Failed = Extract<BunchOutcome, { error: unknown }>;

export function BunchResults({ results, userId, inSale, onFix, onListMore }: {
  results: BunchOutcome[];
  userId: string;
  /** Items went into a moving sale: the links say so. */
  inSale: boolean;
  onFix: (key: string) => void;
  onListMore: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: "start" });
  }, [results]);
  const listed = results.filter((r): r is Listed => "status" in r);
  const failed = results.filter((r): r is Failed => "error" in r);
  const live = listed.filter((r) => r.status === "live").length;
  const review = listed.length - live;
  const keepUpFailed = listed.filter((r) => r.keepUpFailed).length;
  const offersFailed = listed.filter((r) => r.offersFailed).length;
  const tradesFailed = listed.filter((r) => r.tradesFailed).length;
  const shareable = live > 0;
  const next: NextStepValue | null = live > 0
    ? { who: "you", text: t("lp.rs.wait") }
    : review > 0 ? { who: "info", text: `${t("lp.rs.beingChecked")} ${beingChecked()}` } : null;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="bunch-done" data-bunch-results="">
      <h2 id="bunch-done" ref={heading} tabIndex={-1} className="text-base font-semibold focus:outline-none">{t("lp.rs.head")}</h2>
      {failed.length > 0 && (
        <ul className="space-y-2 text-sm" data-bunch-failed="">
          {failed.map((f) => (
            <li key={f.key}>
              <span className="font-semibold">{f.title || t("lp.rs.anItem")}</span> {t("lp.rs.notListed")} {declutterErrorMessage(f.error)}{" "}
              {f.stays ? (<>
                {t("lp.rs.stays")}{" "}
                <Button type="button" variant="link" size="sm" className="h-auto p-0 align-baseline underline" aria-label={t("lp.rs.fixAria", { name: f.title || t("lp.rs.thisItem") })} onClick={() => onFix(f.key)}>{t("lp.rs.fix")}</Button>
              </>) : (
                <>{t("lp.rs.draft")} <Link className="underline" to="/declutter?view=selling">{t("lp.rs.finish")}</Link></>
              )}
            </li>
          ))}
        </ul>
      )}
      {listed.length > 0 && (
        <>
          <p className="text-sm" data-bunch-listed="">
            {[live > 0 ? t("lp.rs.forSale", { n: live }) : null, review > 0 ? t("lp.rs.checking", { n: review }) : null].filter(Boolean).join(", ")}.
            {review > 0 ? ` ${beingChecked()}` : ""}
          </p>
          <ul className="space-y-1 text-sm" data-bunch-listed-items="">
            {listed.map((r) => (
              <li key={r.key} className="break-words">
                {r.id ? <Link className="underline" to={`/declutter/item/${r.id}`}>{r.title}</Link> : r.title}
                {r.status === "pending_review" ? ` ${t("lp.rs.checkingTag")}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {keepUpFailed > 0 && (
        <p className="text-sm" data-bunch-keepup-failed="">
          {keepUpFailed === 1 ? t("lp.rs.keepUp1") : t("lp.rs.keepUpN", { n: keepUpFailed })}
        </p>
      )}
      {offersFailed > 0 && (
        <p className="text-sm" data-bunch-offers-failed="">
          {offersFailed === 1 ? t("lp.rs.offers1") : t("lp.rs.offersN", { n: offersFailed })}
        </p>
      )}
      {tradesFailed > 0 && (
        <p className="text-sm" data-bunch-trades-failed="">
          {tradesFailed === 1 ? t("lp.rs.trades1") : t("lp.rs.tradesN", { n: tradesFailed })}
        </p>
      )}
      {/* A3-69: what comes next, and ONE green primary on the right (owner rule), the others outline. */}
      <NextStep value={next} />
      <div className="flex flex-wrap justify-end gap-2" data-bunch-actions="">
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onListMore}>{t("lp.rs.listMore")}</Button>
        {shareable && (
          <Button type="button" variant="outline" size="sm" className="rounded-full" data-bunch-share=""
            onClick={() => void shareNative({ title: inSale ? t("lp.rs.mySale") : t("lp.rs.myListings"), text: inSale ? t("lp.rs.mySaleOn") : t("lp.rs.myListingsOn"), url: `${getPublicOrigin()}${memberProfilePath(userId)}` })}>
            {inSale ? t("lp.rs.shareSale") : t("lp.rs.shareListings")}
          </Button>
        )}
        {listed.length > 0 && (
          <Button asChild variant="primary" size="sm" className="rounded-full">
            {inSale ? <Link to={memberProfilePath(userId)}>{t("lp.rs.seeSale")}</Link> : <Link to="/declutter?view=selling">{t("lp.rs.seeListings")}</Link>}
          </Button>
        )}
      </div>
    </section>
  );
}
