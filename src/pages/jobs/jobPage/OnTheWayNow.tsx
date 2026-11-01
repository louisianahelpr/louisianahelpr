/**
 * "Yusef is on the way · since 8:51 AM", ABOVE the tracker on the poster's job page (owner 2026-11-01), with a small map
 * of where he is.
 *
 * The time is jobs.helper_on_the_way_at in the job's local (Louisiana) time. The map is the same one the Posted card
 * draws (TrackingMap) off the same job_tracking row the Helpr's en-route watch writes (enRouteLocation.ts ->
 * JobTracking's position update): no new read rule, the row's RLS is the job's two parties. Shown only to the poster,
 * only while the Helpr is on the way (set off, not arrived, job not finished). No position yet (or the job has no
 * point): no map and no empty box, the line alone.
 *
 * ARRIVED (owner 2026-11-01 9:36 and 9:40 AM): "Yusef arrived · 9:04 AM" (jobs.helper_arrived_at) and the same Apple
 * map, with the job's pin and where he was when he tapped Arrived (the job_tracking row's point, which his arrival
 * write stamps; it moves on if he is still sharing), so a poster who is not there can see he is. No GPS text line
 * (owner: "I just need the Apple map view"). Shown until the work is under way.
 *
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("the poster's Helpr is on the way", "the poster's Helpr arrived").
 */
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOnTheWayPosition } from "./onTheWayPosition";
import type { JobPageRow } from "./useJobPage";

const TrackingMap = lazy(() => import("@/components/TrackingMap").then((m) => ({ default: m.TrackingMap })));

/** "8:51 AM" in Louisiana time, the job's own clock. */
function onTheWaySince(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

/** The poster sees this block: set off, not arrived, the job still live. */
export function showsOnTheWay(job: Pick<JobPageRow, "helper_on_the_way_at" | "helper_arrived_at" | "status">): boolean {
  return !!job.helper_on_the_way_at && !job.helper_arrived_at && (job.status === "accepted" || job.status === "in_progress");
}

type NowJob = Pick<JobPageRow, "helper_on_the_way_at" | "helper_arrived_at" | "helper_completed_at" | "poster_confirmed_working_at" | "status">;

/** The poster sees the arrived block: he tapped Arrived, the work has not started, the job is still live. */
export function showsArrived(job: NowJob, trackingStatus: string | null = null): boolean {
  return !!job.helper_arrived_at && !job.helper_completed_at && !job.poster_confirmed_working_at
    && trackingStatus !== "working" && trackingStatus !== "done"
    && (job.status === "accepted" || job.status === "in_progress");
}

/** The on-the-way or arrived block shows (the tracker then leaves out its own "next" line). */
export function showsNow(job: NowJob, trackingStatus: string | null = null): boolean {
  return showsOnTheWay(job) || showsArrived(job, trackingStatus);
}

export function OnTheWayNow({ job, helperFirst, trackingStatus = null }: { job: JobPageRow; helperFirst: string | null; trackingStatus?: string | null }) {
  const arrived = showsArrived(job, trackingStatus);
  const on = showsOnTheWay(job) || arrived;
  const pos = useQuery({
    queryKey: ["job-page", "on-the-way-position", job.id],
    queryFn: () => fetchOnTheWayPosition(job.id),
    enabled: on,
    // The Helpr's watch writes a new point as he drives; the poster's map follows it while the block shows.
    refetchInterval: on ? 30_000 : false,
  });
  if (!on) return null;
  const p = pos.data;
  const name = helperFirst ?? "Your Helpr";
  const mapped = p != null && (arrived ? p.status === "arrived" : p.status === "on_the_way") && p.latitude != null && p.longitude != null && job.latitude != null && job.longitude != null;
  return (
    <section aria-label={arrived ? "Arrived" : "On the way"} data-on-the-way={arrived ? undefined : ""} data-arrived-now={arrived ? "" : undefined} className="space-y-2">
      {arrived && job.helper_arrived_at ? (
        <p className="text-ds-16 font-semibold text-foreground">
          {name} arrived <span className="font-normal text-muted-foreground">· {onTheWaySince(job.helper_arrived_at)}</span>
        </p>
      ) : job.helper_on_the_way_at ? (
        <>
          <p className="text-ds-16 font-semibold text-foreground">
            {name} is on the way <span className="font-normal text-muted-foreground">· since {onTheWaySince(job.helper_on_the_way_at)}</span>
          </p>
          <p className="text-ds-13 text-muted-foreground">You'll confirm once they say they've arrived.</p>
        </>
      ) : null}
      {mapped && (
        <div data-on-the-way-map="" className="overflow-hidden rounded-2xl">
          <Suspense fallback={null}>
            <TrackingMap helperLat={p.latitude!} helperLng={p.longitude!} destLat={job.latitude!} destLng={job.longitude!} helperLive={!arrived} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
