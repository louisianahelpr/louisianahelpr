/**
 * press-every-control 43855620891 (2026-11-16): 212 presses on /declutter item
 * cards, 19 /messages Declutter threads and 2 /25days/rules links failed as
 * GATE MISSes on writes that only LOOKING makes (an item view, its funnel
 * step, the viewer's own talk read time, the sponsor page's visit count).
 * Each is now a side effect: still aborted and noted, not a miss. Their
 * neighbours (buying, messaging, entering) stay writes.
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/declutter_record_item_view": | "/rest/v1/rpc/declutter_record_item_view_x":
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/declutter_mark_talk_read": | "/rest/v1/rpc/declutter_mark_talk_read_x":
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/sponsor_log_visit": | "/rest/v1/rpc/sponsor_log_visit_x":
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const kind = (path: string, body = "{}"): string => safety.pressWriteKind({ method: "POST", url: `${BASE}${path}`, body });

describe("press gate: writes made by looking (run 43855620891)", () => {
  it("opening a Declutter item, a Declutter talk or the sponsor page is a side effect", () => {
    expect(kind("/rest/v1/rpc/declutter_record_item_view")).toBe("side-effect");
    expect(kind("/rest/v1/rpc/declutter_funnel_event")).toBe("side-effect");
    expect(kind("/rest/v1/rpc/declutter_mark_talk_read")).toBe("side-effect");
    expect(kind("/rest/v1/rpc/sponsor_log_visit")).toBe("side-effect");
  });

  it("the controls next to them are still writes", () => {
    expect(kind("/rest/v1/rpc/declutter_send_talk_message")).toBe("write");
    expect(kind("/rest/v1/rpc/sponsor_enter_giveaway")).toBe("write");
    expect(Object.keys(safety.PRESS_SIDE_EFFECT_WRITES).length).toBeGreaterThan(9);
  });
});
