/**
 * NIGHT-JOBSMA5-1 (audit 10-30 night, High): jobs whose rounded points coincide (get_open_jobs_for_map rounds to 2
 * decimals, about 1 km, for privacy) form a cluster that zooming can never split, so they could not be opened from
 * the map at all. Such a cluster's press now lists its jobs here; each row opens the job exactly as the pin preview's
 * card does (onJobAction). A cluster that CAN split still zooms, as before.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MapJob } from "./config";
import { clusterCannotSplit, clusterElement } from "./mapMarkers";
import { regionFromBounds, type getMapKit, type MKAnnotation, type MKMap } from "./mapkitRuntime";

type MapKit = NonNullable<ReturnType<typeof getMapKit>>;

/** The cluster bubble's element: zooms to the members, or (when they can't be split) hands their job ids to onList. */
export function clusterBubble(mk: MapKit, map: MKMap, members: MKAnnotation[], onList: (jobIds: string[]) => void): HTMLElement {
  const coords = members.map((m) => m.coordinate);
  const lists = clusterCannotSplit(coords);
  return clusterElement(members.length, () => {
    if (!coords.length) return;
    if (lists) {
      onList(members.map((m) => m.data?.jobId).filter((id): id is string => typeof id === "string"));
      return;
    }
    const lats = coords.map((c) => c.latitude);
    const lngs = coords.map((c) => c.longitude);
    map.setRegionAnimated(regionFromBounds(mk, [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], 1.4), true);
  }, ["job", "jobs"], lists);
}

export function ClusterList({ jobs, onOpen, onClose }: { jobs: MapJob[]; onOpen: (jobId: string) => void; onClose: () => void }) {
  // Escape closes it, like the pin preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (jobs.length === 0) return null;
  const heading = `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} in this area`;
  return (
    <section
      aria-label={heading}
      data-testid="browse-map-cluster-list"
      className="absolute inset-x-2 top-2 z-[420] mx-auto max-w-[26rem] max-h-[60%] overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg motion-safe:animate-fade-in"
    >
      <div className="flex items-center justify-between gap-2 pl-2">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <Button type="button" variant="ghost" size="icon" className="ctl-exit" aria-label="Close" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {jobs.map((j) => (
          <li key={j.id}>
            <Button type="button" variant="ghost" size="wrap" className="w-full justify-start text-left" onClick={() => onOpen(j.id)}>
              <span className="flex min-w-0 flex-col items-start">
                <span className="font-medium [overflow-wrap:anywhere]">{j.title}</span>
                <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{j.location ?? j.parish}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
