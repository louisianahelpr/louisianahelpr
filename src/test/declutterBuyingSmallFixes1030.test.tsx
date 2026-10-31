/**
 * The buying audit's small findings of 10-30, each confirmed in the code or on prod's definition first. Words a member
 * reads, so each is held by what it says.
 *
 * BUY-13: Free can't be saved, and a search saved without it would alert on everything else in the category.
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | {member && !filters.freeOnly && (q \|\| filters.category | {member && (q \|\| filters.category
 * BUY-14: the Buying tab is called Buying, and a meetup isn't a pickup.
 * @mutate src/components/declutter/DeclutterPaySettling.tsx | the order moves to Buying once | the order moves to Purchases once
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | {order.handover === "meetup" ? "Meeting" : "Pickup"}: <span | Pickup: <span
 * BUY-18: a free item has no payment, and a porch claim picks a day.
 * @mutate src/components/declutter/DeclutterBundleRow.tsx | {item.current_price_cents === 0 ? "Get them together: one pickup." : pickup ? | {pickup ?
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {confirm.isPending ? "Confirming…" : "Confirm and pick a time"} | {confirm.isPending ? "Confirming…" : chosen === "porch" ? "Confirm and pick a day" : "Confirm and pick a time"}
 * BUY-19: Make an offer opens the box ready to type.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   useEffect(() => { if (open) offerBox.current?.focus(); }, [open]);\n |
 * BUY-20: a failed delivery check never blames the payment page.
 * @mutate src/lib/declutter/delivery.ts | if (!isQuote(quote)) throw new Error("delivery_check_unavailable"); | if (!isQuote(quote)) throw new Error("payment_unavailable");
 * BUY-29: accepting a Wanted reply or a counter says what missing the 48 hours costs (declutter_deadline_sweep: source 'offer').
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | check out and pay, or you get a strike. Nothing is charged until you do. | check out and pay; nothing is charged until you do.
 * BUY-45: a truck owner isn't told to add a truck; there is no medium size; a failed payout isn't "on its way".
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | {vehicle.data?.has_truck ? "" : " Large items only show once you add a truck."} | {" Large items only show once you add a truck."}
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx | : t.payout_status === "failed" ? "Delivered. Your pay didn't go through yet. Check that your payout account is set up." | : t.payout_status === "failed" ? "Delivered. Your pay is on its way."
 * @mutate src/components/declutter/DeliverVehicleForm.tsx | With a truck you can take small and large items. | With a truck you can take small, medium and large items.
 * BUY-47: declutter_payouts_due stops at 12 attempts, so nothing promises it keeps trying.
 * @mutate src/lib/declutter/payoutWords.ts | set up. If it still doesn't arrive, message Support."; | set up. We'll keep trying.";
 * BUY-48: the seller's handover photos use the shared button.
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | <PhotoPickButton id={fileId} picked={photo} disabled={busy} onPick={setPhoto} /> | <input id={fileId} type="file" accept="image/*" disabled={busy} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
 * BUY-53: with Pause all on a row doesn't claim a channel, and deleting a search asks first.
 * @mutate src/lib/savedSearches.ts | const channel = paused ? "Paused" : !s.notify_enabled | const channel = !s.notify_enabled
 * @mutate src/pages/profile/SavedSearchesTab.tsx | <SheetDestructiveAction onClick={() => setAsking(true)} disabled={busy}> | <SheetDestructiveAction onClick={() => remove.mutate()} disabled={busy}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { DECLUTTER_CLIENT_ERROR_COPY } from "@/lib/declutter/errors";
import { payoutStatusWords } from "@/lib/declutter/payoutWords";
import { rowSummary, type SavedSearch } from "@/lib/savedSearches";

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
const D = "src/components/declutter/";

describe("the buying audit's small findings", () => {
  it("BUY-13: no Save this search while Free is on", () => {
    expect(code(`${D}DeclutterBrowseView.tsx`)).toMatch(/\{member && !filters\.freeOnly && \(q \|\| filters\.category/);
  });

  it("BUY-14: the words name what's on screen", () => {
    expect(code(`${D}DeclutterPaySettling.tsx`)).toContain("the order moves to Buying once");
    expect(code(`${D}DeclutterPaySettling.tsx`)).not.toContain("Purchases");
    expect(code(`${D}DeclutterHandoverViews.tsx`)).toContain('{order.handover === "meetup" ? "Meeting" : "Pickup"}: <span');
  });

  // LEAD-PLACE-TIMES (owner 2026-10-31): a porch claim now picks a time inside the place's hours, as a door claim does.
  it("BUY-18: a free item is never told about a payment, and every claim picks a time", () => {
    expect(code(`${D}DeclutterBundleRow.tsx`)).toContain('item.current_price_cents === 0 ? "Get them together: one pickup."');
    expect(code(`${D}DeclutterFreeClaim.tsx`)).toContain('{confirm.isPending ? "Confirming…" : "Confirm and pick a time"}');
    expect(code(`${D}DeclutterFreeClaim.tsx`)).not.toContain("pick a day");
  });

  it("BUY-19: the offer box takes focus when it opens", () => {
    const panel = code(`${D}DeclutterOfferPanel.tsx`);
    expect(panel).toContain("useEffect(() => { if (open) offerBox.current?.focus(); }, [open]);");
    expect(panel).toContain("ref={offerBox}");
  });

  it("BUY-20: a delivery check that fails says so, and its code has words", () => {
    for (const f of ["src/lib/declutter/delivery.ts", "src/lib/declutter/sellerDelivery.ts"]) {
      expect(code(f), f).toContain("delivery_check_unavailable");
      expect(code(f), f).not.toContain("payment_unavailable");
    }
    expect(DECLUTTER_CLIENT_ERROR_COPY.delivery_check_unavailable).toBe("We couldn't check delivery for that address. Please try again. Nothing was charged.");
  });

  it("BUY-29: accepting a reply warns about the strike", () => {
    expect(code(`${D}DeclutterOffersSection.tsx`)).toContain("check out and pay, or you get a strike. Nothing is charged until you do.");
  });

  it("BUY-45: the Deliver words are true for this Helpr", () => {
    const views = code(`${D}DeclutterDeliveryViews.tsx`);
    expect(views).toContain('{vehicle.data?.has_truck ? "" : " Large items only show once you add a truck."}');
    expect(views).toContain("Delivered. Your pay didn't go through yet.");
    expect(code(`${D}DeliverVehicleForm.tsx`)).not.toContain("small, medium");
  });

  it("BUY-47: a failed payout promises nothing the payout run stops doing", () => {
    const words = payoutStatusWords({ status: "failed", items_cents: 1000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0 });
    expect(words).not.toMatch(/keep trying/i);
    expect(words).toContain("message Support");
  });

  it("BUY-48: no raw file input on the seller's two handover photos", () => {
    for (const f of ["DeclutterHandoverViews.tsx", "SellerDeliveryOrder.tsx"]) expect(code(`${D}${f}`), f).toContain("<PhotoPickButton id={fileId} picked={photo}");
    expect(code(`${D}SellerDeliveryOrder.tsx`)).not.toContain('type="file"');
  });

  it("BUY-53: a paused row says Paused; delete asks first", () => {
    const s = { name: "Chairs", section: "declutter", notify_enabled: true, notify_email: true, query: null, category: null } as unknown as SavedSearch;
    expect(rowSummary(s).startsWith("Email")).toBe(true);
    expect(rowSummary(s, true).startsWith("Paused")).toBe(true);
    const tab = code("src/pages/profile/SavedSearchesTab.tsx");
    expect(tab).toContain("<SheetDestructiveAction onClick={() => setAsking(true)}");
    expect(tab).toContain("Yes, delete it");
  });
});
