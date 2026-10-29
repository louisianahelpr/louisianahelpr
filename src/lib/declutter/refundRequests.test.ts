/**
 * Audit 1b D2-7: askRefund sends p_photo_paths only when there are photos, so a request with none is exactly the
 * three-argument call the live declutter_ask_refund(uuid, text, text) takes, and photos go once the server takes them.
 *
 * @mutate src/lib/declutter/refundRequests.ts |   const args = photoPaths.length ? { ...base, p_photo_paths: [...photoPaths] } : base; |   const args = { ...base, p_photo_paths: [...photoPaths] };
 * @mutate src/lib/declutter/refundRequests.ts |   const args = photoPaths.length ? { ...base, p_photo_paths: [...photoPaths] } : base; |   const args = base;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcs = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => { rpcs.push([name, args]); return Promise.resolve({ data: { result: "asked" }, error: null }); } },
}));

import { askRefund } from "./refundRequests";

beforeEach(() => { rpcs.length = 0; });

describe("askRefund", () => {
  it("no photos: the three arguments only; photos: p_photo_paths too", async () => {
    await askRefund("o1", "damaged", "Cracked");
    expect(rpcs[0]).toEqual(["declutter_ask_refund", { p_order_id: "o1", p_reason: "damaged", p_note: "Cracked" }]);
    await askRefund("o1", "damaged", "Cracked", ["u1/declutter/problem/o1/a.jpg"]);
    expect(rpcs[1]).toEqual(["declutter_ask_refund", { p_order_id: "o1", p_reason: "damaged", p_note: "Cracked", p_photo_paths: ["u1/declutter/problem/o1/a.jpg"] }]);
  });
});
