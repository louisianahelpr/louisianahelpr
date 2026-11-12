/**
 * Audit 11-10 F372: order cards had no item photo while cart and offer cards did, so a list of orders scanned by title
 * only. The order read carries the photo (declutter_my_cart.photo_path, migration 20261112054500) and the card head
 * (OrderCardHead) shows it at the left: the 160 px square first, the original if that fails, then a grey square.
 * Backend proof: src/test/pglite/declutterMyCartPhotoPath.pglite.mjs (3x; NEW_MIGRATION=skip red; 3 mutants FAIL).
 *
 * @mutate src/components/declutter/OrderCardHead.tsx |       <OrderThumb path={order.lines.find((l) => l.photo_path)?.photo_path ?? undefined} />\n |
 * @mutate src/components/declutter/OrderCardHead.tsx | <OrderThumb path={order.lines.find((l) => l.photo_path)?.photo_path ?? undefined} /> | <OrderThumb path={undefined} />
 * @mutate supabase/migrations/20261112054500_declutter_my_cart_photo_path.sql |            WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1) |            WHERE ph.item_id = c.item_id ORDER BY ph.position DESC LIMIT 1)
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { resolve } from "node:path";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  photoPublicUrl: (p: string) => `https://photos.test/${p}`,
}));
vi.mock("./useMyTrades", () => ({ useTradedFor: () => new Map() }));
import { OrderCardHead } from "./OrderCardHead";

const order = (photo: string | null | undefined, second?: string) => ({
  orderId: "o1", side: "buyer", handover: "pickup_home", status: "paid", deliveryTaskId: null,
  lines: [
    { line_id: "l1", item_id: "i1", item_title: "Oak chair", price_cents: 4000, source: "buy", photo_path: photo },
    ...(second ? [{ line_id: "l2", item_id: "i2", item_title: "Lamp", price_cents: 1000, source: "buy", photo_path: second }] : []),
  ],
}) as never;

describe("F372: the order card shows its item photo", () => {
  it("the photo sits in the head; on failure the original, then grey", () => {
    const { unmount } = render(<OrderCardHead order={order("s1/i1/a.jpg")} userId="me" />);
    const box = document.querySelector("[data-order-head] [data-order-thumb]");
    const img = box?.querySelector("img") as HTMLImageElement;
    // squarePhotoUrl answers only for storage URLs, so this test host gets the original at once.
    expect(img.getAttribute("src")).toBe("https://photos.test/s1/i1/a.jpg");
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.error(img);
    fireEvent.error(box?.querySelector("img") as HTMLImageElement);
    expect(box?.querySelector("img")).toBeNull();
    expect(document.querySelector("[data-order-head]")?.textContent).toContain("Oak chair");
    unmount();
  });

  it("a bundle uses the first line that has a photo; none at all keeps a grey square", () => {
    const a = render(<OrderCardHead order={order(null, "s1/i2/x.jpg")} userId="me" />);
    expect(document.querySelector("[data-order-thumb] img")?.getAttribute("src")).toBe("https://photos.test/s1/i2/x.jpg");
    a.unmount();
    render(<OrderCardHead order={order(undefined)} userId="me" />);
    expect(document.querySelector("[data-order-thumb]")).not.toBeNull();
    expect(document.querySelector("[data-order-thumb] img")).toBeNull();
  });

  it("the order read (declutter_my_cart) carries the item's first photo", () => {
    const def = effectiveDefs(resolve(__dirname, "../../../supabase/migrations")).get("declutter_my_cart");
    expect(def?.file).toMatch(/20261112054500_declutter_my_cart_photo_path\.sql$/);
    const fn = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
    expect(fn).toContain("source text, photo_path text)");
    expect(fn).toContain("(SELECT ph.storage_path FROM public.declutter_item_photos ph WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)");
    expect(fn).toContain("WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)");
  });
});
