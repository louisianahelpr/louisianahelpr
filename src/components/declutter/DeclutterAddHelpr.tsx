/**
 * Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 * On the buyer's paid order: one tap books a Helpr to put the item together,
 * hang it on the wall or set it up at their place. Each choice opens Post a
 * Job pre-filled; the buyer sets the price and pays like any job, and the job
 * is linked back here. Behind the hidden switch 'declutter_add_helpr'; the
 * server refuses anyone it is off for (20261016053527).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { useAgeGate } from "@/hooks/useAgeGate";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/statusLabels";
import { fetchSetupHelpr, isBookedSetupJob, SETUP_KIND_INFO, SETUP_KINDS } from "@/lib/declutter/setupHelpr";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ErrorState } from "@/components/ui/ErrorState";

const btn = "inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 text-sm font-semibold";

export function AddHelprPanel({ orderId }: { orderId: string }) {
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
  return (
    <section className="space-y-2 rounded-xl border border-border p-3" aria-label="Add a Helpr">
      <p className="text-sm font-semibold">Need a hand with it?</p>
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
      <p className="text-sm text-muted-foreground">
        Book a Helpr to come to your place. You set the price and pay like any job.
      </p>
      <div className="flex flex-wrap gap-2">
        {SETUP_KINDS.map((k) => (
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
    </section>
  );
}
