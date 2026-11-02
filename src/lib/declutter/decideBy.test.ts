/**
 * A3-74 (lead 11-01): "Louisiana Helpr usually decides within 2 days (by Tue 11/3, 9 PM)" on both sides, and the admin
 * queue puts overdue problems first (oldest due first), the rest in the order they came; a failed read keeps the queue.
 *
 * @mutate src/lib/declutter/handover.ts |   return [...overdue, ...out.filter((r) => !(due(r) < now))]; |   return out;
 * @mutate src/lib/declutter/handover.ts | .sort((a, b) => due(a) - due(b)); | ;
 * @mutate src/lib/declutter/handover.ts |     return rows;\n  }\n  const by | \n  }\n  const by
 * @mutate src/lib/declutter/decideBy.ts |   return `${day}, ${time.replace(":00", "")}`; |   return `${day}, ${time}`;
 */
import { describe, expect, it, vi } from "vitest";

const res = vi.hoisted(() => ({ data: [] as unknown[] | null, error: null as unknown }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: res.data, error: res.error }) }) }) },
}));

import { decideByWords, decidesBy } from "./decideBy";
import { withDecideBy, type AdminProblem } from "./handover";

const p = (id: string) => ({ id, order_id: "o", reporter_side: "buyer", reason: "damaged", note: "", photo_paths: [], created_at: "", detail: null }) as AdminProblem;
const NOW = new Date("2026-11-03T12:00:00Z").getTime();

describe("decide-by (A3-74)", () => {
  it("says the day and time in Louisiana words, or nothing before Louisiana Helpr has it", () => {
    expect(decideByWords("2026-11-04T03:00:00Z")).toBe("Tue 11/3, 9 PM");
    expect(decideByWords("2026-11-04T03:30:00Z")).toBe("Tue 11/3, 9:30 PM");
    expect(decidesBy("2026-11-04T03:00:00Z")).toBe(" Louisiana Helpr usually decides within 2 days (by Tue 11/3, 9 PM).");
    expect(decidesBy(null)).toBe("");
  });

  it("the queue: overdue first, oldest due first; the rest keep their order", async () => {
    res.error = null;
    res.data = [
      { id: "a", decide_by: "2026-11-05T00:00:00Z" },
      { id: "b", decide_by: "2026-11-03T00:00:00Z" },
      { id: "c", decide_by: null },
      { id: "d", decide_by: "2026-11-02T00:00:00Z" },
    ];
    const out = await withDecideBy([p("a"), p("b"), p("c"), p("d")], NOW);
    expect(out.map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
    expect(out[0].decide_by).toBe("2026-11-02T00:00:00Z");
  });

  it("a failed read keeps the queue as it was", async () => {
    res.data = null;
    res.error = { message: "boom" };
    const rows = [p("a"), p("b")];
    expect(await withDecideBy(rows, NOW)).toBe(rows);
  });
});
