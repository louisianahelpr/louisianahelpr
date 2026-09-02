// Panel 4 — when jobs actually get posted near you.
//
// This is the panel a helper cannot build for themselves. After
// 20260831232513 a helper's RLS view of `public.jobs` is their own rows only,
// so the shape of everyone else's posting behaviour is only reachable through
// the SECURITY DEFINER RPC. It is also the one that most directly answers "how
// do I earn more": being in the app when the work appears.
//
// THE GRID IS EITHER REAL OR ABSENT. `market.demand` arrives as NULL below the
// posting floor and this renders the shortfall instead of a grid of zeros — a
// heatmap of nothing and a heatmap of "nobody posts at 3am" are visually
// identical and mean opposite things. On prod today the market population
// excludes seeded rows, so this panel truthfully reports that there is not yet
// enough real posting history. That is the correct answer, not a broken one.

import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { NotEnoughYet } from "@/components/analytics/NotEnoughYet";
import {
  BLOCK_LABELS,
  BLOCK_SPAN_LABELS,
  DOW_LABELS,
  DOW_SHORT,
  demandGrid,
  scopeLabel,
  type AnalyticsFloors,
  type AnalyticsMarket,
} from "@/lib/helperAnalytics";

interface DemandPanelProps {
  market: AnalyticsMarket | undefined;
  floors: AnalyticsFloors;
}

export function DemandPanel({ market, floors }: DemandPanelProps) {
  const grid = demandGrid(market?.demand);
  const where = scopeLabel(market);
  const caption = (
    <>
      Jobs posted in {where} over the last {market?.window_days ?? 180} days, in Louisiana time.
      Each row is a 4-hour block starting at the hour shown.
      {market?.scope === "statewide" &&
        " Add a parish to your profile and this narrows to your area."}
    </>
  );

  if (!grid || grid.total === 0) {
    return (
      <AnalyticsPanel title="When work shows up" caption={caption}>
        <NotEnoughYet
          what="the posting clock"
          have={market?.sample ?? 0}
          need={floors.market_jobs}
          unit="jobs posted nearby"
        />
      </AnalyticsPanel>
    );
  }

  const busiest = grid.busiest!;

  return (
    <AnalyticsPanel title="When work shows up" caption={caption}>
      {/* Fixed 7-column grid of equal fractions — it shrinks rather than
          scrolls, so the page body never gains a horizontal scrollbar at 320. */}
      {/* Capped: at 1440 the seven fluid columns stretched to ~170px each and
          the heatmap stopped reading as a clock and started reading as a bar
          chart. It still shrinks freely below the cap, so 320px is unaffected. */}
      <div className="space-y-1 max-w-[520px]">
        <div className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] gap-1">
          <span />
          {DOW_SHORT.map((d) => (
            <span
              key={d}
              className="text-ds-11 text-center"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {d}
            </span>
          ))}
        </div>
        {BLOCK_LABELS.map((blockLabel, block) => (
          <div key={blockLabel} className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] gap-1">
            <span
              className="text-ds-11 leading-5 tabular-nums"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              {blockLabel}
            </span>
            {DOW_LABELS.map((d, dow) => {
              const n = grid.cells[dow][block];
              // Opacity, not hue: one ink at six weights reads as a single
              // quantity. A rainbow scale would imply categories.
              const strength = grid.peak > 0 ? n / grid.peak : 0;
              return (
                <div
                  key={d}
                  title={`${d} ${blockLabel}: ${n} ${n === 1 ? "job" : "jobs"}`}
                  className="h-5 rounded"
                  style={{
                    background:
                      n === 0
                        ? "hsl(var(--olivewood) / 0.05)"
                        : `hsl(var(--bark) / ${0.18 + strength * 0.72})`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-ds-12 leading-snug" style={{ color: "hsl(var(--olivewood))" }}>
        Busiest stretch:{" "}
        <span className="font-semibold">
          {DOW_LABELS[busiest.dow]} {BLOCK_SPAN_LABELS[busiest.block]}
        </span>{" "}
        — {busiest.jobs} of {grid.total} postings.
      </p>
    </AnalyticsPanel>
  );
}
