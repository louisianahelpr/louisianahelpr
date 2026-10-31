/**
 * Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 * On the buyer's paid order: one tap books a Helpr to move the item to their
 * place (GROW-5, "Need help moving it?"), put it together, hang it on the wall
 * or set it up there. Each choice opens Post a
 * Job pre-filled; the buyer sets the price and pays like any job, and the job
 * is linked back here. Behind the hidden switch 'declutter_add_helpr'; the
 * server refuses anyone it is off for (20261017073146).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { useAgeGate } from "@/hooks/useAgeGate";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/statusLabels";
import { fetchSetupHelpr, isBookedSetupJob, SETUP_KIND_INFO, setupKindsFor } from "@/lib/declutter/setupHelpr";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ErrorState } from "@/components/ui/ErrorState";

const btn = "inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 text-sm font-semibold";

export function AddHelprPanel({ orderId, bookedOnly = false }: {
  orderId: string;
  /** BUY-31: the item is going back or on hold, so no new offer; a Helpr already booked still shows. */
  bookedOnly?: boolean;
}) {
  const on = useFeature("declutter_add_helpr");
  // Under 18 cannot post a job (Q1586(c)): the choices grey out and say why.
  const { underAge, explain, gatedProps } = useAgeGate();
  const info = useQuery({
    queryKey: ["declutter", "setup-helpr", orderId],
    queryFn: () => fetchSetupHelpr(orderId),
    enabled: on,
  });
  if (!on) return null;
  // item_not_found = the offer's window closed (30 days after the handover) or
  // the order was refunded: nothing to offer, so nothing shows (money review #5).
  if (info.isError && (info.error as { message?: string })?.message === "item_not_found") return null;
  if (info.isError) {
    return <ErrorState variant="inline" title="We couldn't load the Helpr options." body={declutterErrorMessage(info.error)} onRetry={() => void info.refetch()} />;
  }
  if (!info.data) return null;
  const booked = info.data.jobs.filter(isBookedSetupJob);
  // Only the choices these items can need (audit #27: "Put it together" on a mug); none and nothing booked = no panel.
  const kinds = setupKindsFor(info.data.item_details, info.data.handover);
  if (booked.length === 0 && (bookedOnly || kinds.length === 0)) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border p-3" aria-label="Add a Helpr">
      {!bookedOnly && <p className="text-sm font-semibold">{kinds.includes("move") ? "Need help moving it?" : "Need a hand with it?"}</p>}
      {booked.length > 0 && (
        <ul className="space-y-1 text-sm">
          {booked.map((j) => (
            <li key={j.job_id}>
              <Link to={`/jobs/${j.job_id}`} className="font-medium underline underline-offset-2">{j.title}</Link>
              {" · "}{JOB_STATUS_LABELS[j.status as JobStatus] ?? "Posted"}
            </li>
          ))}
        </ul>
      )}
      {kinds.length > 0 && !bookedOnly && (
        <>
        <p className="text-sm text-muted-foreground">
          {kinds.includes("move")
            ? "Book a Helpr to bring it home or set it up. You set the price and pay like any job."
            : "Book a Helpr to come to your place. You set the price and pay like any job."}
        </p>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <Link
              key={k}
              to={`/post-job?declutterOrder=${encodeURIComponent(orderId)}&help=${k}`}
              className={btn}
              {...gatedProps("post")}
              onClick={(e) => { if (underAge) { e.preventDefault(); explain("post"); } }}
            >
              {SETUP_KIND_INFO[k].button}
            </Link>
          ))}
        </div>
        </>
      )}
    </section>
  );
}
