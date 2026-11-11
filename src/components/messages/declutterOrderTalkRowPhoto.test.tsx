/**
 * F422 (whole-app audit 2026-11-10; owner pop-up 11-11 morning): a Declutter order chat's Messages row leads with the
 * item's photo, like a job row (owner: "Declutter rows get the item photo instead of the grey sofa icon"). The server
 * half (declutter_my_order_talks' `photo_path`, 20261111155616) is proven in
 * src/test/pglite/declutterOrderTalk.pglite.mjs (red with PHOTO_MIGRATION=skip).
 *
 * Here, for every side x open/ended x photo/no photo: the row shows the item photo (a small square transform of the
 * public Declutter photo, never the full original when a transform URL forms) exactly when the item has one, and the
 * sofa only when it has none. The title stays the row's headline.
 *
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx |       {photo ? ( |       {false ? (
 * @mutate src/lib/declutter/orderTalk.ts |   return squarePhotoUrl(original, ORDER_TALK_PHOTO_PX) ?? original; |   return original;
 * @mutate src/lib/declutter/orderTalk.ts |   if (!row.photo_path) return null; |   return null;
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";
import { OrderTalkRow, orderTalkRowTitle } from "./DeclutterOrderTalkInbox";

afterEach(cleanup);

const SELLER = "00000000-0000-4000-8000-0000000000c3";
const ITEM = "00000000-0000-4000-8000-0000000000d4";
const PATH = `${SELLER}/declutter/${ITEM}/first.jpg`;

const row = (over: Partial<OrderTalkListRow>): OrderTalkListRow => ({
  order_id: "00000000-0000-4000-8000-0000000000a1",
  side: "buyer",
  title: "Brass lamp",
  last_at: "2026-11-10T12:00:00Z",
  last_mine: false,
  open: true,
  ...over,
});

describe("F422: a Declutter order chat's row leads with the item photo (owner 11-11)", () => {
  it("photo exactly when the item has one; the sofa only without", () => {
    let drawn = 0;
    for (const side of ["buyer", "seller"] as const) {
      for (const open of [true, false]) {
        for (const photo_path of [PATH, null, undefined]) {
          const r = row({ side, open, photo_path });
          const { container } = render(<MemoryRouter><OrderTalkRow row={r} /></MemoryRouter>);
          const label = `${side} open=${open} photo=${String(photo_path)}`;
          const img = container.querySelector("[data-order-talk-photo]");
          expect(!!img, label).toBe(!!photo_path);
          expect(!!container.querySelector("svg.lucide-sofa"), `${label}: sofa only without a photo`).toBe(!photo_path);
          if (img) {
            const src = img.getAttribute("src") ?? "";
            expect(src, label).toContain(PATH);
            expect(src, `${label}: a small square, not the original`).toMatch(/\/storage\/v1\/render\/image\/public\/.*width=96&height=96/);
          }
          expect(screen.getByText(orderTalkRowTitle(r)), label).toBeTruthy();
          cleanup();
          drawn++;
        }
      }
    }
    expect(drawn).toBeGreaterThan(10);
  });
});
