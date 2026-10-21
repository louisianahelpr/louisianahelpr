/**
 * nightly-red #2353, press-every-control 39376366289 (2026-10-20): 91 GATE
 * MISSes on the admin shards. Two classes:
 *  - opening a bell notification marks it read (PATCH /rest/v1/notifications,
 *    714 aborted), so a notification row is a MUTATING control;
 *  - thirteen STABLE read RPCs (admin_last_activity, declutter_my_cart, …) and
 *    a read-only edge function (stripe-payouts) were aborted as writes of the
 *    tap that opened their page; analytics_events is a navigation side effect.
 * Plus three mutating labels no word named: "Unsave Helpr", "Reverse",
 * "Connect Google / Apple".
 *
 * @mutate scripts/audit/pressProdSafety.mjs | export const NOTIFICATION_OPEN_RX = /^Notifications \u203a /; | export const NOTIFICATION_OPEN_RX = /^$/;
 * @mutate e2e/readRpc.ts |   "admin_last_activity",\n | \n
 * @mutate scripts/audit/pressProdSafety.mjs |   "stripe-payouts": "reads | "stripe-payouts-x": "reads
 * @mutate scripts/audit/press-every-control.mjs | got it\|unsave\|reverse\|connect (?:google\|apple))\b/i; | got it)\b/i;
 * @mutate scripts/audit/press-every-control.mjs | \|\| isNotificationOpen({ label }) \|\| isAdminWrite | \|\| isAdminWrite
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const { isNotificationOpen, pressWriteKind } = safety as {
  isNotificationOpen: (a: { label: string }) => boolean;
  pressWriteKind: (a: { method: string; url: string }) => string;
};
const { DESTRUCTIVE_RX } = harness as { DESTRUCTIVE_RX: RegExp };
import { blankComments } from "./helpers/blankNonCode";

const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const READ_RPCS = [
  "admin_gift_card_paid_job_ids", "admin_last_activity", "admin_last_logins", "admin_stalled_job_queue", "admin_support_queue",
  "declutter_haul_away_state", "declutter_my_cart", "declutter_my_offers", "declutter_seller_moving_sale",
  "has_pre_verification_wipe", "poster_crew_block_fee_cents", "rentals_browse_listings", "rentals_my_ended_deposits",
];

describe("press run 39376366289: the gate classes what that run caught", () => {
  it("a bell notification row is mutating; the bell button itself is not", () => {
    expect(isNotificationOpen({ label: "Notifications › New member joined Ashley Braus from Kaplan" })).toBe(true);
    expect(isNotificationOpen({ label: "Notifications" })).toBe(false);
    expect(pressWriteKind({ method: "PATCH", url: `${BASE}/rest/v1/notifications?id=eq.x` })).toBe("write");
  });

  it("the main loop gates a notification row like any other mutating control", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/\|\| isNotificationOpen\(\{ label \}\) \|\| isAdminWrite/);
  });

  it.each(READ_RPCS)("rpc %s reads", (name) => {
    expect(pressWriteKind({ method: "POST", url: `${BASE}/rest/v1/rpc/${name}` })).toBe("read");
  });

  it("stripe-payouts reads; analytics_events is a side effect; an unknown RPC still writes", () => {
    expect(pressWriteKind({ method: "POST", url: `${BASE}/functions/v1/stripe-payouts` })).toBe("read");
    expect(pressWriteKind({ method: "POST", url: `${BASE}/rest/v1/analytics_events` })).toBe("side-effect");
    expect(pressWriteKind({ method: "POST", url: `${BASE}/rest/v1/rpc/admin_set_something` })).toBe("write");
  });

  it.each(["Unsave Helpr", "Reverse", "Connect Google", "Connect Apple"])("%s is a mutating label", (label) => {
    expect(DESTRUCTIVE_RX.test(label)).toBe(true);
  });
});
