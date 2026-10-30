/**
 * Audit 1030 DB-4: the buyer's plain total said "with pickup" on items whose seller offers no pickup (checkout then
 * had none). The words follow the ways the seller ticked (declutter_items.handovers).
 * @mutate src/lib/declutter/pickupWords.ts |   if (ways.includes("porch")) return "porch"; |   if (ways.length) return "porch";
 * @mutate src/lib/declutter/pickupWords.ts | way === "none" ? "before delivery" : "with pickup"; | "with pickup";
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | At most, {totalPhrase(way)}. | At most, with pickup.
 * @mutate src/components/declutter/DeclutterReserveSheet.tsx | Total {totalPhrase(way)}</dt> | Total with pickup</dt>
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | pendingClassName="font-normal" /> {forPhrase(way)}</> | pendingClassName="font-normal" /> for pickup</>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { forPhrase, noDeliveryWay, totalPhrase } from "./pickupWords";

describe("DB-4: the plain total names a way the seller offers", () => {
  it("an older item (no ticks) is a pickup, as before", () => {
    expect(noDeliveryWay(null)).toBe("pickup");
    expect(noDeliveryWay(undefined)).toBe("pickup");
    expect(totalPhrase(noDeliveryWay(null))).toBe("with pickup");
  });

  it("porch ticked: porch pickup; meetup only: a safe meetup; deliveries only: before delivery", () => {
    expect(totalPhrase(noDeliveryWay(["porch", "delivery"]))).toBe("with porch pickup");
    expect(totalPhrase(noDeliveryWay(["meetup", "seller_delivery"]))).toBe("at a safe meetup");
    expect(totalPhrase(noDeliveryWay(["seller_delivery", "delivery"]))).toBe("before delivery");
    expect(totalPhrase(noDeliveryWay([]))).toBe("before delivery");
    expect(forPhrase(noDeliveryWay(["meetup"]))).toBe("for a safe meetup");
    expect(forPhrase(noDeliveryWay(["delivery"]))).toBe("before delivery");
  });

  it("no buyer total line on the item page hard-codes \"with pickup\" / \"for pickup\" any more (floor: 3 files read)", () => {
    const files = ["DeclutterOfferPanel.tsx", "DeclutterReserveSheet.tsx", "OfferSentWhatNext.tsx"]
      .map((f) => blankComments(readFileSync(`src/components/declutter/${f}`, "utf8")));
    expect(files.filter((s) => s.length > 500)).toHaveLength(3);
    for (const s of files) expect(s).not.toMatch(/(Total|At most,) with pickup|\/> for pickup/);
  });
});
