/**
 * VN-33 (owner, 2026-09-14): a poster who hasn't confirmed a GPS-verified arrival
 * is nudged right away, again at 2h, and escalated to admin at 24h — once each.
 */
import { describe, expect, it } from "vitest";
import { arrivalNudgeStage } from "../../supabase/functions/_shared/arrivalNudge";

const at = (h: number) => new Date(Date.parse("2026-09-15T10:00:00Z") + h * 3_600_000);
const V = "2026-09-15T10:00:00Z";
const L = (first?: number, second?: number, esc?: number) => ({
  first_sent_at: first == null ? null : at(first).toISOString(),
  second_sent_at: second == null ? null : at(second).toISOString(),
  escalated_at: esc == null ? null : at(esc).toISOString(),
});

describe("arrivalNudgeStage", () => {
  it("nudges right away when nothing has been sent", () => {
    expect(arrivalNudgeStage(V, null, at(0.1))).toBe("first");
  });
  it("waits until 2h for the second nudge, then sends it once", () => {
    expect(arrivalNudgeStage(V, L(0), at(1.9))).toBeNull();
    expect(arrivalNudgeStage(V, L(0), at(2))).toBe("second");
    expect(arrivalNudgeStage(V, L(0, 2), at(5))).toBeNull();
  });
  it("escalates at 24h, even if the second nudge was missed, and only once", () => {
    expect(arrivalNudgeStage(V, L(0, 2), at(24))).toBe("escalate");
    expect(arrivalNudgeStage(V, L(0), at(30))).toBe("escalate");
  });
  it("never escalates in the same breath as a late first nudge", () => {
    expect(arrivalNudgeStage(V, L(29.9), at(30))).toBeNull();
    expect(arrivalNudgeStage(V, L(28), at(30))).toBe("escalate");
    expect(arrivalNudgeStage(V, L(0, 2, 24), at(48))).toBeNull();
  });
  it("sends the first nudge before anything else, however late the run", () => {
    expect(arrivalNudgeStage(V, null, at(30))).toBe("first");
  });
});
