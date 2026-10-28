/**
 * Declutter haul-away on My listings (docs/specs/declutter-haul-away.md):
 * when listings haven't sold, one tap books a Helpr to take them to a
 * donation center or the dump. The tap opens Post a Job pre-filled
 * (`/post-job?haulAway=<ids>`); the seller checks it and pays like any job.
 * Hidden unless the 'declutter_haul_away' switch is on for the member; the
 * server refuses without it too.
 */
import { Link } from "react-router-dom";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { daysUntil, haulAwayPostJobPath } from "@/lib/declutter/haulAwayLink";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { DonatePicker, DonationReceipts } from "./DeclutterDonate";

/** "Dresser, 2 chairs, boxes": the first few titles, then how many more. */
export function leftoversLine(titles: string[], shown = 3): string {
  const head = titles.slice(0, shown).join(", ");
  const more = titles.length - shown;
  return more > 0 ? `${head} and ${more} more` : head;
}

/**
 * Owner, 2026-10-21 (Q2261): a paused listing must be relisted before a
 * haul-away can take it. The server keeps refusing one (declutter_link_haul_away
 * takes only 'live' or 'ended'; declutter_haul_away_state lists only those), so
 * the screen says so: under each paused listing, and on the card when the seller
 * has paused items it left out.
 */
const PAUSED_HAUL_AWAY_CARD_LINE = "Paused items can't be hauled away. Relist an item first to add it.";
const PAUSED_HAUL_AWAY_ITEM_LINE = "Paused items can't be hauled away. Relist it first to add it to a haul-away.";

/**
 * The one-tap card above the list (board 164, "Haul it away"): the items one
 * trip can take, where they go, and one button that opens Post a Job
 * pre-filled. The day and the price are set there, like any job.
 */
export function HaulAwayCard({ group, pausedCount = 0 }: { group: HaulAwayRow[]; pausedCount?: number }) {
  // Q2428: the seller's donation receipts sit with the haul-away (they come from it), shown even when nothing is left to haul.
  if (group.length === 0) return <DonationReceipts />;
  const n = group.length;
  return (
    <>
    <DonationReceipts />
    <section
      aria-labelledby="haul-away-title"
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      data-haul-away-card=""
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 rounded-full bg-muted p-2" aria-hidden>
          <Truck className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="haul-away-title" className="text-base font-semibold">Haul it away</h2>
          <p className="text-ds-13 text-muted-foreground">A Helpr picks up what didn't sell.</p>
        </div>
      </div>
      <dl className="divide-y divide-border rounded-2xl border border-border">
        <div className="px-4 py-3 min-w-0">
          <dt className="text-ds-15 font-semibold">{n === 1 ? "1 item hasn't sold" : `${n} items haven't sold`}</dt>
          <dd className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">{leftoversLine(group.map((r) => r.title))}</dd>
        </div>
        <div className="px-4 py-3 min-w-0">
          <dt className="text-ds-15 font-semibold">Where it goes</dt>
          <dd className="text-ds-13 text-muted-foreground">
            To donation, or the dump if donation won't take {n === 1 ? "it" : "something"}. The Helpr sends a photo at drop-off.
          </dd>
        </div>
      </dl>
      <p className="text-ds-13 text-muted-foreground">
        Posted as a job: you pick the day and price, and pay like any job. Booking takes {n === 1 ? "it" : "them"} off sale.
      </p>
      {pausedCount > 0 && (
        <p className="text-ds-13 text-muted-foreground" data-haul-paused="">
          {PAUSED_HAUL_AWAY_CARD_LINE}
        </p>
      )}
      <Button asChild className="w-full sm:w-auto">
        <Link to={haulAwayPostJobPath(group.map((r) => r.item_id))}>
          {n === 1 ? "Post a haul-away job" : `Post a haul-away job for ${n} items`}
        </Link>
      </Button>
      <DonatePicker itemIds={group.map((r) => r.item_id)} />
    </section>
    </>
  );
}

/** The buttons an unpaid haul-away adds to its listing's action row: finish booking, or put it back on sale (spec step 1). */
export function HaulAwayItemActions({
  row,
  onFinishBooking,
  onPutBack,
  pending,
}: {
  row: HaulAwayRow | undefined;
  onFinishBooking: (row: HaulAwayRow) => void;
  onPutBack: (row: HaulAwayRow) => void;
  pending: boolean;
}) {
  if (row?.state !== "unpaid") return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onFinishBooking(row)}>
        Finish booking
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onPutBack(row)}>
        Put back on sale
      </Button>
    </>
  );
}

/**
 * The haul-away line under one listing: hauled, booked, paying, not booked, or
 * when it opens. A paused listing has no row (the server lists only items for
 * sale or off sale), so its status says to relist it first (Q2261).
 */
export function HaulAwayItemLine({ row, itemStatus }: { row: HaulAwayRow | undefined; itemStatus?: string }) {
  if (!row) {
    if (itemStatus !== "paused") return null;
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="paused">
        {PAUSED_HAUL_AWAY_ITEM_LINE}
      </p>
    );
  }
  if (row.state === "hauled") {
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="hauled">
        A Helpr hauled this away.{" "}
        {row.job_id && (
          <Link to={`/jobs/${row.job_id}`} className="font-medium text-foreground underline underline-offset-2">
            See the job
          </Link>
        )}
      </p>
    );
  }
  if (row.state === "booked") {
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="booked">
        A Helpr is booked to haul this away.{" "}
        {row.job_id && (
          <Link to={`/jobs/${row.job_id}`} className="font-medium text-foreground underline underline-offset-2">
            See the job
          </Link>
        )}
      </p>
    );
  }
  if (row.state === "paying") {
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="paying">
        A checkout for this haul-away is still open. Pay there, or come back in an hour when it runs out.
      </p>
    );
  }
  if (row.state === "unpaid") {
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="unpaid">
        Off sale for a haul-away that isn't booked. Finish booking, or put the item back on sale.
      </p>
    );
  }
  if (row.state === "too_soon") {
    const d = daysUntil(row.eligible_at);
    return (
      <p className="text-xs text-muted-foreground" data-haul-state="too_soon">
        Not selling? In {d} {d === 1 ? "day" : "days"} you can have a Helpr haul it away.
      </p>
    );
  }
  return null;
}
