/**
 * Shops Helpr delivery (20261106211136): the Helpr's answer to a shop's "the Helpr didn't come" goes to
 * shop_helpr_answer_no_show (declutter_helpr_answer_no_show refuses a shop task); a Declutter task's answer is unchanged.
 * @mutate src/lib/declutter/noHelpr.ts |   if (sourceKind === "shop_delivery") { |   if (sourceKind === "never") {
 * The optional answer photo is sent as p_photo_path, and only when there is one.
 * @mutate src/lib/declutter/noHelpr.ts | { p_task_id: taskId, p_note: note, p_photo_path: photoPath } : | { p_task_id: taskId, p_note: note } :
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, unknown]> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: "p1", error: null }; } },
}));

import { answerHelprNoShow } from "./noHelpr";

beforeEach(() => { calls.length = 0; });

describe("answerHelprNoShow picks the task's own RPC", () => {
  it("a shop delivery's answer goes to shop_helpr_answer_no_show", async () => {
    expect(await answerHelprNoShow("t1", "I was there", "shop_delivery")).toBe("p1");
    expect(calls).toEqual([["shop_helpr_answer_no_show", { p_task_id: "t1", p_note: "I was there" }]]);
  });
  it("a Declutter delivery's answer (or an unknown kind) keeps declutter_helpr_answer_no_show", async () => {
    await answerHelprNoShow("t2", "I was there", "declutter_delivery");
    await answerHelprNoShow("t3", "I was there");
    expect(calls.map((c) => c[0])).toEqual(["declutter_helpr_answer_no_show", "declutter_helpr_answer_no_show"]);
  });
  it("a photo goes as p_photo_path to either RPC", async () => {
    await answerHelprNoShow("t4", "I was there", "shop_delivery", "u/task/t4/a.jpg");
    await answerHelprNoShow("t5", "I was there", "declutter_delivery", "u/task/t5/b.jpg");
    expect(calls).toEqual([
      ["shop_helpr_answer_no_show", { p_task_id: "t4", p_note: "I was there", p_photo_path: "u/task/t4/a.jpg" }],
      ["declutter_helpr_answer_no_show", { p_task_id: "t5", p_note: "I was there", p_photo_path: "u/task/t5/b.jpg" }],
    ]);
  });
});
