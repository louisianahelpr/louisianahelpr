/**
 * BUY-22 (buying audit 10-30), its D2-9 part: a pickup holds "Report a problem" back until the booked pickup is over
 * (pickupTimeOver), but a Helpr delivery offered it while nobody had taken the job yet. Now a Helpr delivery shows it
 * once the Helpr has the item, or 15 minutes after the Helpr's booked pickup time; while a Helpr is still being found,
 * or with no task at all, there is none.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   return v.status === "accepted" && !!v.pickup_slot_start && now >= new Date(v.pickup_slot_start).getTime() + 15 * 60_000; |   return v.status !== "unfilled";
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   if (v.status === "picked_up" \|\| v.status === "delivered" \|\| v.status === "confirmed") return true; |   if (v.status === "delivered" \|\| v.status === "confirmed") return true;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | stage="delivery" trigger={deliveryProblemTimeCame(v)} /> | stage="delivery" />
 * (The panel itself, with its task read, has its own tests: declutterDeliveryViews.test.tsx.)
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | askGot={askGot} problemForm={!problem} /></Suspense> | askGot={askGot} /></Suspense>
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";


import { deliveryProblemTimeCame } from "./DeclutterDeliveryViews";

const NOW = Date.parse("2026-10-31T18:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("BUY-22 / D2-9: a Helpr delivery's Report a problem waits like a pickup's", () => {
  it("none while a Helpr is being found, or before the Helpr's pickup time is over", () => {
    expect(deliveryProblemTimeCame({ status: "open", pickup_slot_start: null }, NOW)).toBe(false);
    expect(deliveryProblemTimeCame({ status: "accepted", pickup_slot_start: ago(-60) }, NOW)).toBe(false);
    expect(deliveryProblemTimeCame({ status: "accepted", pickup_slot_start: ago(10) }, NOW)).toBe(false);
    expect(deliveryProblemTimeCame({ status: "accepted", pickup_slot_start: null }, NOW)).toBe(false);
    expect(deliveryProblemTimeCame({ status: "unfilled", pickup_slot_start: null }, NOW)).toBe(false);
  });

  it("shown 15 minutes after the Helpr's pickup time, and once the Helpr has it", () => {
    expect(deliveryProblemTimeCame({ status: "accepted", pickup_slot_start: ago(15) }, NOW)).toBe(true);
    for (const status of ["picked_up", "delivered", "confirmed"] as const) {
      expect(deliveryProblemTimeCame({ status, pickup_slot_start: null }, NOW)).toBe(true);
    }
  });

  it("the delivery panel's own button waits for deliveryProblemTimeCame (the panel reads the task)", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterDeliveryViews.tsx", "utf8"));
    const forms = src.match(/\{problemForm && <ProblemForm orderId=\{orderId\} side=\{side\} stage="delivery" trigger=\{deliveryProblemTimeCame\(v\)\} \/>\}/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
  });

  it("the delivery branch hands the form to the panel, and keeps no button of its own (inventory floor)", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterHandoverViews.tsx", "utf8"));
    const uses = src.match(/<OrderDeliveryPanel [^>]*problemForm=\{!problem\}/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(src).not.toContain('<ProblemForm orderId={order.orderId} side={order.side} stage="delivery" />');
  });
});
