/**
 * THE PRESS GATE READS WHAT THE DATABASE DECLARES (Declutter audit 2026-10-28).
 *
 * audit2's press.log held 109 GATE MISS lines, and they were the harness's,
 * not the app's:
 *  - 13 RPCs the app calls on opening a screen (declutter_bundle_rule,
 *    helpr_my_tasks, sms_phone_prompt_due, ...) are declared STABLE (prod
 *    pg_proc.provolatile = 's', read 2026-10-28) but named outside the read
 *    allowlist, so the network gate aborted them as "writes";
 *  - 23 bell-panel rows (PATCH /rest/v1/notifications) went ungated because
 *    the main loop handed isNotificationOpen the row's own words, never the
 *    "Notifications" step of its chain;
 *  - 5 "Watch <item>" hearts (declutter_set_watch, VOLATILE: a real write)
 *    named no gated word.
 * Each aborted press is a FAIL, so the sweep's numbers meant nothing.
 *
 * @mutate scripts/audit/pressProdSafety.mjs | isReadRpcPath(pathname) \|\| isDeclaredReadRpcPath(pathname) \|\| | isReadRpcPath(pathname) \|\|
 * @mutate scripts/audit/declaredReadRpcs.mjs | .filter(([, v]) => !v.includes("v")) | .filter(([, v]) => v.length > 0)
 * @mutate scripts/audit/press-every-control.mjs | isNotificationOpen({ label, chain: entry.chain }) | isNotificationOpen({ label })
 * @mutate scripts/audit/pressProdSafety.mjs | Array.isArray(chain) && chain.length ? chain.join( | false ? chain.join(
 * @mutate scripts/audit/press-every-control.mjs | connect (?:google\|apple)\|watch\|unwatch)\b/i; | connect (?:google\|apple))\b/i;
 * @mutate scripts/audit/press-every-control.mjs |   if (rpc) return !(READ_RPC_RX.test(rpc[1]) \|\| isDeclaredReadRpcPath(path)); |   if (rpc) return !READ_RPC_RX.test(rpc[1]);
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredReadRpcSet, declaredReadRpcs } from "../../scripts/audit/declaredReadRpcs.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
import { blankComments } from "./helpers/blankNonCode";

const { isNotificationOpen, pressWriteKind } = safety as {
  isNotificationOpen: (a: { label: string; chain?: string[] }) => boolean;
  pressWriteKind: (a: { method: string; url: string }) => string;
};
const { DESTRUCTIVE_RX, isWriteRequest } = harness as {
  DESTRUCTIVE_RX: RegExp;
  isWriteRequest: (a: { method: string; url: string; status: number }) => boolean;
};

const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
/** Every RPC name in audit2's GATE MISS lines that prod declares STABLE. */
const AUDIT2_STABLE_RPCS = [
  "declutter_bundle_rule", "declutter_item_questions", "declutter_my_donations", "declutter_my_move_out_date",
  "declutter_my_seller_delivery", "declutter_price_hint", "declutter_setup_helpr", "declutter_visible_reviews",
  "helpr_my_tasks", "helpr_tasks_open_near", "payout_setup_hire_allowed_for_me", "rentals_my_leases", "sms_phone_prompt_due",
];

describe("the press gate classes RPCs by their declared volatility", () => {
  it("reads every migration (floor: 478 declared-read names on 2026-10-28)", () => {
    expect(declaredReadRpcSet().size).toBeGreaterThan(400);
    expect(AUDIT2_STABLE_RPCS.length).toBeGreaterThan(12);
  });

  it.each(AUDIT2_STABLE_RPCS)("%s is a read, to the gate and to the write recorder", (name) => {
    const url = `${BASE}/rest/v1/rpc/${name}`;
    expect(pressWriteKind({ method: "POST", url })).toBe("read");
    expect(isWriteRequest({ method: "POST", url, status: 200 })).toBe(false);
  });

  it("a VOLATILE RPC still writes (declutter_set_watch), and so does an unknown one", () => {
    for (const name of ["declutter_set_watch", "declutter_seller_cancel_sale", "no_such_function_anywhere"]) {
      const url = `${BASE}/rest/v1/rpc/${name}`;
      expect(pressWriteKind({ method: "POST", url }), name).toBe("write");
      expect(isWriteRequest({ method: "POST", url, status: 200 }), name).toBe(true);
    }
  });

  it("fails closed: one VOLATILE overload anywhere, or a STABLE that only the body mentions, keeps the name a write", () => {
    const dir = mkdtempSync(join(tmpdir(), "declared-read-"));
    try {
      writeFileSync(join(dir, "20260101000000_a.sql"), [
        "CREATE OR REPLACE FUNCTION public.reads_only(p uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;",
        "CREATE FUNCTION public.mixed(p uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;",
        "CREATE FUNCTION public.mixed(p text) RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN INSERT INTO t VALUES (1); RETURN 1; END $fn$;",
        "CREATE FUNCTION public.body_says_stable() RETURNS void LANGUAGE plpgsql AS $$ BEGIN -- STABLE\n UPDATE t SET x = 1; END $$;",
        "CREATE FUNCTION public.pure(x int) RETURNS int IMMUTABLE LANGUAGE sql AS 'SELECT x';",
      ].join("\n"));
      writeFileSync(join(dir, "20260102000000_b.sql"),
        "CREATE OR REPLACE FUNCTION public.became_volatile() RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;\n" +
        "CREATE OR REPLACE FUNCTION public.became_volatile() RETURNS int LANGUAGE sql VOLATILE AS $$ SELECT 1 $$;");
      expect([...declaredReadRpcs(dir)].sort()).toEqual(["pure", "reads_only"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a bell-panel row is gated by its chain, not its own words", () => {
  it("the row reads as a notification open; the bell button does not", () => {
    const row = "Offer declined Hallie declined your offer for \"[E2E DO NOT A";
    expect(isNotificationOpen({ label: row, chain: ["Notifications", row] })).toBe(true);
    expect(isNotificationOpen({ label: "Notifications", chain: ["Notifications"] })).toBe(false);
    expect(isNotificationOpen({ label: row, chain: [row] })).toBe(false);
  });

  it("the main loop hands it the press's chain", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/isNotificationOpen\(\{ label, chain: entry\.chain \}\)/);
  });
});

describe("a Watch heart is a mutating control (declutter_set_watch is VOLATILE)", () => {
  it.each(["Watch Fixture rocking chair [E2E-PRODAUDIT] runmdivxodm", "Unwatch Fixture rocking chair",
    // A3-98 (11-01): the hearts now read Save / Remove ... from saved; both stay gated.
    "Save Fixture rocking chair [E2E-PRODAUDIT] runmdivxodm", "Remove Fixture rocking chair from saved", "Save this item", "Remove from saved"])("%s", (label) => {
    expect(DESTRUCTIVE_RX.test(label)).toBe(true);
  });
});
