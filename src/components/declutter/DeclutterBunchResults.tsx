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
  const shareable = live > 0;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="bunch-done" data-bunch-results="">
      <h2 id="bunch-done" ref={heading} tabIndex={-1} className="text-base font-semibold focus:outline-none">What happened</h2>
      {failed.length > 0 && (
        <ul className="space-y-2 text-sm" data-bunch-failed="">
          {failed.map((f) => (
            <li key={f.key}>
              <span className="font-semibold">{f.title || "An item"}</span> wasn't listed: {declutterErrorMessage(f.error)}{" "}
              {f.stays ? (<>
                It's still on the list.{" "}
                <Button type="button" variant="link" size="sm" className="h-auto p-0 align-baseline underline" aria-label={`Fix ${f.title || "this item"}`} onClick={() => onFix(f.key)}>Fix it</Button>
              </>) : (
                <>It's saved as a draft under Selling. <Link className="underline" to="/declutter?view=selling">Finish it</Link></>
              )}
            </li>
          ))}
        </ul>
      )}
      {listed.length > 0 && (
        <>
          <p className="text-sm" data-bunch-listed="">
            {[live > 0 ? `${live} for sale` : null, review > 0 ? `${review} waiting for a review` : null].filter(Boolean).join(", ")}.
          </p>
          <ul className="space-y-1 text-sm" data-bunch-listed-items="">
            {listed.map((r) => (
              <li key={r.key} className="break-words">
                {r.id ? <Link className="underline" to={`/declutter/item/${r.id}`}>{r.title}</Link> : r.title}
                {r.status === "pending_review" ? " (waiting for a review)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {keepUpFailed > 0 && (
        <p className="text-sm" data-bunch-keepup-failed="">
          "Keep it up" didn't turn on for {keepUpFailed} {keepUpFailed === 1 ? "item" : "items"}. You can turn it on from Manage listing.
        </p>
      )}
      {offersFailed > 0 && (
        <p className="text-sm" data-bunch-offers-failed="">
          Offers are still on for {offersFailed} {offersFailed === 1 ? "item" : "items"}. You can turn them off from Manage listing.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {listed.length > 0 && (
          <Button asChild variant="outline" size="sm" className="rounded-full">
            {inSale ? <Link to={`/user/${userId}`}>See your sale</Link> : <Link to="/declutter?view=selling">See your listings</Link>}
          </Button>
        )}
        {shareable && (
          <Button type="button" variant="outline" size="sm" className="rounded-full" data-bunch-share=""
            onClick={() => void shareNative({ title: inSale ? "My moving sale" : "My listings", text: inSale ? "My moving sale on Louisiana Helpr" : "My listings on Louisiana Helpr", url: `${getPublicOrigin()}/user/${userId}` })}>
            {inSale ? "Share your sale" : "Share your listings"}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onListMore}>List more</Button>
      </div>
    </section>
  );
}
