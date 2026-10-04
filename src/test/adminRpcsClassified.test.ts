/**
 * Every RPC the admin surface calls is classified read or write, at PR time.
 *
 * The same check runs in the nightly prod-audit suite
 * (e2e/prod-audit/admin-views.spec.ts), where READ_RPC is the firewall that
 * lets an admin screen load while refusing writes. It is static, so it belongs
 * here too: admin_gift_card_paid_job_ids (Q454) merged on 2026-10-04 and was
 * first seen as a red prod-audit run (37183911901), not as a red PR.
 * Classification lives once, in e2e/adminRpcClassification.ts.
 */
// @mutate src/components/admin/AdminSupport.tsx | rpc("admin_support_queue" | rpc("admin_support_items"
// @mutate e2e/adminRpcClassification.ts | \|admin_gift_card_paid_job_ids(\?\|$))/; | )/;
import { describe, expect, it } from "vitest";
import { adminRpcNames, unclassifiedAdminRpcs, writesTheFirewallPasses } from "../../e2e/adminRpcClassification";

describe("admin RPCs are classified read or write", () => {
  const names = adminRpcNames();

  it("finds the admin surface's RPC calls", () => {
    expect(names.length).toBeGreaterThan(15); // 17 on 2026-10-04
  });

  it("every one is matched by READ_RPC or named in WRITE_RPC", () => {
    expect(
      unclassifiedAdminRpcs(names),
      "check pg_proc.provolatile / pg_get_functiondef on prod, then add each to READ_RPC or WRITE_RPC in e2e/adminRpcClassification.ts",
    ).toEqual([]);
  });

  it("no write is passed by the read firewall", () => {
    expect(writesTheFirewallPasses()).toEqual([]);
  });
});
