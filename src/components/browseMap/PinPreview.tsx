import type { RefObject } from "react";
import JobCard from "@/components/dashboard/JobCard";
import type { MapJob } from "./config";
import { mapJobToEnrichedJob } from "./mapJobToEnrichedJob";
import { PreviewCaret } from "./MapOverlays";
import type { PreviewPlacement } from "./previewPlacement";

/**
 * Pin preview: a POPOVER anchored to the tapped pin (owner, 2026-09-15), moved out of BrowseMap.tsx unchanged (Q806,
 * the god-component ratchet). BrowseMap owns the placement (the sync effect measures `wrapRef` and hands back
 * `preview`: left/top and the caret) and the focus (`cardRef`); this renders it. The card stays hidden until the first
 * measurement so it never flashes at 0,0, and it is still the SAME `<JobCard bare>` the feed renders.
 */
export function PinPreview({
  selectedJob,
  selectedCrewSpots,
  preview,
  wrapRef,
  cardRef,
  effectiveFee,
  onJobAction,
}: {
  selectedJob: MapJob;
  selectedCrewSpots: number | null;
  preview: PreviewPlacement | null;
  wrapRef: RefObject<HTMLDivElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  effectiveFee?: number;
  onJobAction?: (jobId: string) => void;
}) {
  return (
    <div
      className="absolute z-[420] pointer-events-none"
      style={{
        left: preview?.left ?? 0,
        top: preview?.top ?? 0,
        width: "min(26rem, calc(100% - 16px))",
        visibility: preview ? "visible" : "hidden",
      }}
    >
        <div
          ref={wrapRef}
          className="relative w-full pointer-events-none motion-safe:animate-fade-in"
        >
          {/* Caret pointing UP — card is BELOW the pin (flipped). Two
              stacked triangles: the back one is the card's border colour,
              the front one the card's fill, 1px lower — a border-drawn
              caret without an SVG. */}
          {preview?.caretDir === "up" && <PreviewCaret dir="up" left={preview.caretLeft} />}
        <aside
          // Named with the JOB, not just "Job preview": a keyboard/screen
          // reader user lands on the card inside this landmark, and
          // the complementary landmark's name is what tells them WHICH pin
          // they just opened. "Job preview" alone would announce the
          // container and nothing about the content.
          aria-label={`Job preview: ${selectedJob.title}`}
          data-testid="browse-map-preview"
          className="pointer-events-auto w-full motion-safe:animate-fade-in overflow-hidden"
          style={{
            // 0.5rem, not 1rem: `JobCard bare` clips its own content to
            // rounded-lg and carries no paint of its own, so this element
            // IS the card's surface. Matching the radius (and holding no
            // padding) is what makes the box fit the card exactly — the
            // header lane and the inset that produced the white band above
            // the card are gone (VN-9).
            borderRadius: "0.5rem",
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            boxShadow:
              "inset 0 1px 0 0 hsl(var(--card) / 0.9), " +
              "0 1px 3px hsl(var(--olivewood) / 0.1), " +
              "0 14px 28px -8px hsl(var(--olivewood) / 0.16), " +
              "0 32px 64px -16px hsl(var(--olivewood) / 0.2)",
          }}
        >
          <div ref={cardRef}>
            <JobCard
              job={mapJobToEnrichedJob(selectedJob, selectedCrewSpots)}
              effectiveFee={effectiveFee ?? 0}
              onSelect={() => onJobAction?.(selectedJob.id)}
              onApply={() => onJobAction?.(selectedJob.id)}
              onReport={() => { /* no report surface on the map pin preview */ }}
              guestPricing={effectiveFee === undefined}
              bare
            />
          </div>
        </aside>
          {/* Caret pointing DOWN — card is ABOVE the pin (the default). */}
          {preview?.caretDir === "down" && <PreviewCaret dir="down" left={preview.caretLeft} />}
        </div>
    </div>
  );
}
