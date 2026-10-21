/**
 * Cowork design audit 2026-10-20, J1: one job, three prices. Measured on prod
 * for the owner's job 11f8b084 (budget 60.00, legacy fee model, 12% tier):
 *   $60  her Posted card (the budget she set),
 *   $52  the Browse card (a Helpr's take-home: 60 less 12%, floored),
 *   $50  the description text she typed (owner content, not app-computed).
 * The app-made disagreement is the POSTER being shown a Helpr's take-home on
 * her own job. The class: every JobPrice render site decides "is the viewer
 * this job's poster?" and shows that poster the price they set.
 *
 * @mutate src/components/dashboard/JobCard.tsx |   const showBudget = guestPricing \|\| isOwnJob; |   const showBudget = guestPricing;
 * @mutate src/components/dashboard/JobDetailDialog.tsx |               showBudget={!!viewerUserId && viewerUserId === job.customer_id} |               showBudget={false}
 */
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const REPO = resolve(__dirname, "..", "..");
const POSTER = "poster-owner";

function giveaway(): EnrichedJob {
  return {
    id: "11f8b084-ccd1-47b6-92ab-26338f701468", title: "GIVE AWAY!!", description: "A thank-you.",
    category: "other", budget: 60, location: "Lafayette, LA", parish: "Lafayette",
    date_needed: jobLocalDateISO(5), start_time: null, created_at: new Date("2026-10-09T12:00:00Z").toISOString(),
    expires_at: null, customer_id: POSTER, is_urgent: false, urgent_fee: 0, is_group_job: false,
    helpers_needed: 1, is_recurring: false, helper_fee_flat_cents: null,
  } as unknown as EnrichedJob;
}
const priceText = (viewer: string | undefined) => {
  const { container } = render(
    <JobCard job={giveaway()} effectiveFee={12} currentUserId={viewer} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} userLat={null} userLng={null} />,
  );
  return (container.querySelector(".money-chip")?.textContent ?? "").replace(/\s+/g, "");
};

describe("J1: the poster sees the price they set on their own job", () => {
  it("own job on Browse: $60, the same figure as the Posted card", () => {
    expect(priceText(POSTER)).toMatch(/^\$?60(\.00)?$/);
  });
  it("anyone else: the Helpr take-home ($52 on this legacy 12% job)", () => {
    expect(priceText("someone-else")).toMatch(/^\$?52$/);
  });

  it("inventory: every JobPrice render site asks whether the viewer is the poster", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => !/\.test\.tsx?$/.test(f));
    const sites = files
      .map((f) => ({ f: relative(REPO, f), src: blankComments(readSource(f) ?? "") }))
      .filter(({ src }) => /<JobPrice\b/.test(src));
    expect(files.length).toBeGreaterThan(500);
    // Sites whose jobs can never be the viewer's own, and why (each re-read when its feed changes).
    const NEVER_OWN: Record<string, string> = {
      "src/pages/home/homeDashboard/FirstJobHome.tsx":
        "board 189 'Jobs near you' reads get_ranked_open_jobs, which filters j.customer_id <> auth.uid() (20261021062609), so the viewer never posted these; the Helpr take-home is right",
    };
    expect(sites.map((s) => s.f).sort()).toEqual(
      ["src/components/dashboard/JobCard.tsx", "src/components/dashboard/JobDetailDialog.tsx", "src/pages/home/homeDashboard/FirstJobHome.tsx"].sort(),
    );
    for (const { f, src } of sites) {
      if (f in NEVER_OWN) continue;
      for (const m of src.matchAll(/<JobPrice\b[\s\S]*?\/>/g)) {
        const showBudget = /showBudget=\{([^}]*)\}/.exec(m[0])?.[1] ?? "";
        const decided = /customer_id/.test(showBudget) || (showBudget === "showBudget" && /const showBudget = [^;]*isOwnJob/.test(src) && /isOwnJob = [^;]*customer_id/.test(src));
        expect(decided, `${f}: a <JobPrice> that never asks whether the viewer posted the job`).toBe(true);
      }
    }
  });
});
