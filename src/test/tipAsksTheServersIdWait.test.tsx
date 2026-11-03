/**
 * THE TIP'S ID WAIT IS THE SERVER'S ANSWER (Blockers 10, lead 2026-11-03).
 *
 * THE BUG. create-payment's tip gate (checkIdentityHold), auto-tip-charge and declutter-checkout refuse a tip on
 * payout_waits_on_identity(payee), which exempts a payee the identity_check switch is off for and an enrolled is_seed
 * fixture (identity_check_exempt). The client recomputed it as "the VIEWER's switch is on AND the payee's
 * is_id_verified is false", so it hid a tip the server takes: measured 2026-11-03 on prod, helper-e2e (7b923b19,
 * payout-ready, idv_status 'pending', exempt) drew "Tips open once Hallie finishes verifying." on the Done card while
 * payout_waits_on_identity answered FALSE, and journeys J5's tip leg could not pass.
 *
 * THE FIX. get_safe_profiles returns tip_waits_on_id = payout_waits_on_identity(user_id) (NULL for an anon caller),
 * and useHelprTakesTips / useTipWaitsOnId read it; an RPC without the field (or NULL) keeps the old rule.
 *
 * @mutate src/hooks/useHelprTakesTips.ts |   if (a.tipWaitsOnId !== null) return a.payoutReady && !a.tipWaitsOnId; |   if (a.tipWaitsOnId === false) return a.payoutReady;
 * @mutate src/hooks/useHelprTakesTips.ts |   return a.tipWaitsOnId !== null ? a.tipWaitsOnId : !a.idVerified; |   return !a.idVerified;
 * @mutate src/hooks/useHelprTakesTips.ts |           tipWaitsOnId: typeof row.tip_waits_on_id === "boolean" ? row.tip_waits_on_id : null, |           tipWaitsOnId: row.tip_waits_on_id === true ? true : null,
 * @mutate src/hooks/useHelprTakesTips.ts |   return a.payoutReady && (!idCheckOn \|\| a.idVerified); |   return a.payoutReady;
 * @mutate supabase/migrations/20261103154905_tip_waits_on_id_in_safe_profiles.sql |     CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.payout_waits_on_identity(p.user_id) END AS tip_waits_on_id |     CASE WHEN auth.uid() IS NULL THEN NULL ELSE NOT (p.idv_status IS NOT DISTINCT FROM 'verified') END AS tip_waits_on_id
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const HELPR = "00000000-0000-4000-8000-0000000000aa";
/** One row's fields as get_safe_profiles answers them; `tip_waits_on_id` undefined = an RPC that predates the field. */
const row = vi.hoisted(() => ({ is_payout_ready: true as boolean, is_id_verified: false as boolean, tip_waits_on_id: undefined as boolean | null | undefined }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: { user_ids: string[] }) => {
      if (name !== "get_safe_profiles") return { data: null, error: { message: `unexpected rpc ${name}` } };
      return {
        data: args.user_ids.map((id) => {
          const r: Record<string, unknown> = { user_id: id, is_payout_ready: row.is_payout_ready, is_id_verified: row.is_id_verified };
          if (row.tip_waits_on_id !== undefined) r.tip_waits_on_id = row.tip_waits_on_id;
          return r;
        }),
        error: null,
      };
    },
  },
}));

import { __resetHelprTakesTipsCache, useHelprTakesTips, useTipWaitsOnId } from "@/hooks/useHelprTakesTips";

async function answers() {
  const takes = renderHook(() => useHelprTakesTips(HELPR));
  const waits = renderHook(() => useTipWaitsOnId(HELPR));
  await waitFor(() => expect(takes.result.current).not.toBeNull());
  // useTipWaitsOnId has no "unknown" (false while loading); both hooks share one cached read, so a tick lands it.
  await new Promise((r) => setTimeout(r, 10));
  return { takes: takes.result.current, waits: waits.result.current };
}

beforeEach(() => {
  __resetHelprTakesTipsCache();
  row.is_payout_ready = true;
  row.is_id_verified = false;
  row.tip_waits_on_id = undefined;
  setIdentityCheckOn(true);
});
afterEach(() => setIdentityCheckOn(false));

describe("the tip surfaces ask the server whether the tip waits on the Helpr's ID", () => {
  it("server says it does NOT wait (exempt payee): the tip is offered though is_id_verified is false (the helper-e2e case)", async () => {
    row.tip_waits_on_id = false;
    const a = await answers();
    expect(a.takes).toBe(true);
    expect(a.waits).toBe(false);
  });

  it("server says it waits: no tip, and the line says it waits on ID, even if is_id_verified reads true", async () => {
    row.tip_waits_on_id = true;
    row.is_id_verified = true;
    const a = await answers();
    expect(a.takes).toBe(false);
    expect(a.waits).toBe(true);
  });

  it("payout not ready: no tip, whatever the ID answer", async () => {
    row.tip_waits_on_id = false;
    row.is_payout_ready = false;
    expect((await answers()).takes).toBe(false);
  });

  it("an RPC without the field keeps the old rule: switch on + not verified waits; verified does not", async () => {
    let a = await answers();
    expect(a.takes).toBe(false);
    expect(a.waits).toBe(true);
    __resetHelprTakesTipsCache();
    row.is_id_verified = true;
    a = await answers();
    expect(a.takes).toBe(true);
    expect(a.waits).toBe(false);
  });

  it("a NULL field (anon caller) keeps the old rule too", async () => {
    row.tip_waits_on_id = null;
    const a = await answers();
    expect(a.takes).toBe(false);
    expect(a.waits).toBe(true);
  });
});

describe("the field is the tip gate's own function, in the newest get_safe_profiles", () => {
  const defs = effectiveDefs(join(resolve(__dirname, "..", ".."), "supabase", "migrations"));
  const def = defs.get("get_safe_profiles");
  it("get_safe_profiles returns tip_waits_on_id from payout_waits_on_identity(p.user_id), NULL for anon", () => {
    expect(def, "no effective get_safe_profiles definition").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/\btip_waits_on_id\s+boolean\b/);
    expect(body).toMatch(/CASE\s+WHEN\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN\s+NULL\s+ELSE\s+public\.payout_waits_on_identity\(p\.user_id\)\s+END\s+AS\s+tip_waits_on_id/);
    // Inventory floor: the effective-definition map is the whole migration history, not an empty read.
    expect(defs.size).toBeGreaterThan(500);
  });
});
