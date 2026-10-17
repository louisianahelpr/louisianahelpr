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

/** The one-tap card above the list: the items one trip can take. */
export function HaulAwayCard({ group }: { group: HaulAwayRow[] }) {
  if (group.length === 0) return null;
  const n = group.length;
  return (
    <section
      aria-label="Haul away unsold items"
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 rounded-full bg-muted p-2" aria-hidden>
          <Truck className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{n === 1 ? "1 item hasn't sold" : `${n} items haven't sold`}</p>
          <p className="text-sm text-muted-foreground">
            A Helpr can pick {n === 1 ? "it" : "them"} up and take {n === 1 ? "it" : "them"} to donation, or the dump
            if donation won't take {n === 1 ? "it" : "something"}. You check the job and pay like any job. The Helpr sends
            a photo at drop-off. Booking takes {n === 1 ? "it" : "them"} off sale.
          </p>
        </div>
      </div>
      <Button asChild size="sm">
        <Link to={haulAwayPostJobPath(group.map((r) => r.item_id))}>
          {n === 1 ? "Book a haul-away" : `Book a haul-away for ${n} items`}
        </Link>
      </Button>
    </section>
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

/** The haul-away line under one listing: hauled, booked, paying, not booked, or when it opens. */
export function HaulAwayItemLine({ row }: { row: HaulAwayRow | undefined }) {
  if (!row) return null;
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
