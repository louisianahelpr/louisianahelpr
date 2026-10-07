import { useEffect, useState } from "react";
import { fetchCrewSpotsOpen } from "@/lib/crewSpots";

/**
 * Q1464: a re-listed crew's pin card says its open spots, as the feed card
 * does. The map RPC carries no count, so the previewed crew reads it on its
 * own (best effort: on a miss the card shows the crew's size). Pass the
 * previewed job's id only when it is a crew; null otherwise.
 */
export function useSelectedCrewSpots(selectedCrewId: string | null): number | null {
  const [crewSpots, setCrewSpots] = useState<{ id: string; open: number } | null>(null);
  useEffect(() => {
    if (!selectedCrewId) return;
    let live = true;
    void fetchCrewSpotsOpen([selectedCrewId]).then((m) => {
      const open = m.get(selectedCrewId);
      if (live && open != null) setCrewSpots({ id: selectedCrewId, open });
    });
    return () => { live = false; };
  }, [selectedCrewId]);
  return selectedCrewId && crewSpots?.id === selectedCrewId ? crewSpots.open : null;
}
