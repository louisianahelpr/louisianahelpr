/**
 * A "my ..." read RPC reads only (STABLE), so the prod a11y sweep loads it instead of aborting it.
 *
 * 2026-11-13, A11y in WebKit (prod) 43470000763: /shops/orders said "We couldn't load your custom requests" for both
 * test accounts. The sweep lets through only STABLE/IMMUTABLE RPCs (e2e/a11y-prod/readOnlyRpcs.ts) and logged
 * "aborted volatile rpc shops_my_custom_requests": the read was VOLATILE because it stored lapsed quotes as expired
 * first (20261106202917). That write also took the "price ended" notice from shop_custom_request_sweep, which tells
 * the buyer only for rows its own update moves. Fixed in 20261115181026 (STABLE, the status computed on read).
 *
 * The class, from the migrations (newest effective definition of every function): every public function with
 * `my_` in its name that is VOLATILE is one of the writers below, exactly. A new "my ..." read that writes fails
 * here; a new "my ..." writer is added to the list (each name says what it writes). Measured 2026-11-15: 15.
 * Behaviour (real Postgres): src/test/pglite/shopsMyCustomRequestsReadOnly.pglite.mjs (RED with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261115181026_shops_my_custom_requests_read_only.sql |  STABLE |  VOLATILE
 * @mutate supabase/migrations/20261115181026_shops_my_custom_requests_read_only.sql | 'status', CASE WHEN r.status = 'quoted' AND r.expires_at <= now() THEN 'expired' ELSE r.status END, | 'status', r.status,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rpcVolatility } from "../../e2e/a11y-prod/readOnlyRpcs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** "my ..." functions that write, by name. Exact both ways. */
const MY_WRITERS = [
  "claim_my_referral_code",
  "clear_my_job_post_draft",
  "declutter_on_my_way",
  "declutter_remove_my_meetup_spot",
  "declutter_save_my_meetup_spot",
  "declutter_stop_my_seller_delivery",
  "record_my_signup_source",
  "rpc_ensure_my_handle",
  "rpc_set_my_handle",
  "save_my_job_post_draft",
  "save_my_phone",
  "shops_close_my_shop",
  "shops_save_my_pickup_address",
  "shops_save_my_shop",
  "shops_set_my_faqs",
];

describe("my-read RPCs are STABLE", () => {
  const vol = rpcVolatility(MIGRATIONS);
  const mine = [...vol].filter(([name]) => /(^|_)my_/.test(name));

  it("the inventory is real", () => {
    expect(mine.length).toBeGreaterThan(30);
  });

  it("every VOLATILE my_ function is a listed writer, and every listed writer is still VOLATILE", () => {
    const volatileMine = mine.filter(([, v]) => v === "volatile").map(([n]) => n).sort();
    expect(volatileMine).toEqual(MY_WRITERS);
  });

  it("shops_my_custom_requests is STABLE and its newest body writes nothing", () => {
    expect(vol.get("shops_my_custom_requests")).toBe("stable");
    const def = effectiveDefs(MIGRATIONS).get("shops_my_custom_requests");
    expect(def).toBeDefined();
    expect(blankSqlComments(def!.stmt)).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });

  it("the read reports a lapsed quote as expired", () => {
    const def = effectiveDefs(MIGRATIONS).get("shops_my_custom_requests")!;
    expect(def.stmt).toContain("CASE WHEN r.status = 'quoted' AND r.expires_at <= now() THEN 'expired' ELSE r.status END");
    expect(readFileSync(resolve(MIGRATIONS, "20261115181026_shops_my_custom_requests_read_only.sql"), "utf8")).toContain("REVOKE ALL ON FUNCTION public.shops_my_custom_requests() FROM PUBLIC, anon;");
  });
});
