import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";
import {
  anonExecuteRevoked,
  clientRpcCalls,
  codesReachableFrom,
  findUnmapped,
  findUnwired,
  latestFunctionDefs,
  raisedCodes,
  type Allowlist,
  type CopyTable,
} from "./helpers/rpcErrorInventory";

/**
 * EVERY CODE A CLIENT-CALLED RPC CAN RAISE HAS WORDS AT THE PLACE IT IS CALLED.
 *
 * The bug this was built on (docs/OPEN.md, "Done is final", 2026-09-14): once
 * `open_dispute_as` started refusing completed jobs, a Helpr's Cancel Job
 * (`helper_abort_job` → `rpc_open_dispute` → `open_dispute_as`) could come back
 * `job_already_completed`. ActiveJobSection only knew `not_abortable`, so the
 * person saw "We couldn't send that — check your connection and try again"
 * about a job that had just been marked complete. Nothing was broken; nothing
 * said so. The same shape sat at a dozen other call sites: an RPC grew a
 * guard, and the screen that calls it kept its generic toast.
 *
 * THE CHECK. Inventory from the world, minus what is covered, must be empty:
 *   - every `.rpc("X")` in non-test src/ (TypeScript AST),
 *   - X's latest migration definition and every function it calls,
 *   - each snake_case code those bodies RAISE,
 * must have copy in RPC_ERROR_COPY (src/lib/lifecycleErrors.ts) or an entry
 * below saying why no client can reach it; every call site must read that copy
 * through rpcErrorMessage/rpcErrorCode; and nothing in either table may name a
 * code the RPC no longer raises.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const ANON_REVOKED = "EXECUTE is revoked from anon, so a signed-out caller gets 42501 before the body runs; auth.uid() is never null inside it.";
const LADDER_AFTER_CANCEL =
  "raised by apply_cancellation_violation_consequence, which this RPC calls only after its own UPDATE set status = 'cancelled' on the row it holds FOR UPDATE, as the job's customer.";
const SILENT_PET_READ = "no message exists at this site: JobPetCareSheet's query error reports and hides the pet-care sheet, it shows no copy.";

/** Codes a client cannot reach from the place it calls the RPC. Each says why. */
const UNREACHABLE: Allowlist = {
  // Dispute settlement RPCs (20260915034822). These codes ARE user-reachable,
  // but their copy is rendered by each caller's own dispute-copy path, not the
  // central RPC_ERROR_COPY / rpcErrorMessage: DisputedSection + PostedJobActions
  // route through isExpectedLifecycleRefusal + helperDisputeCopy/posterDisputeControls,
  // and AdminDisputes renders in the admin console. dispute_settlement_in_progress
  // is an EXPECTED_REFUSAL. See lifecycleErrors.ts.
  rpc_withdraw_dispute: {
    dispute_settlement_in_progress: {
      reason: "Expected refusal rendered by DisputedSection/PostedJobActions via isExpectedLifecycleRefusal + their dispute-copy files, not central RPC_ERROR_COPY.",
    },
  },
  rpc_decide_dispute: {
    dispute_settlement_in_progress: {
      reason: "Admin console (AdminDisputes) renders the settlement-in-progress refusal in its own dispute UI, not via rpcErrorMessage.",
    },
    admin_is_party: {
      reason: "Admin-only guard: AdminDisputes gates the decide controls for an admin who is a party, and renders any raised code in its own admin dispute UI.",
    },
  },
  helper_abort_job: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    reason_required: {
      reason: "ActiveJobSection disables Cancel Job until abortReason.trim().length >= 5 and sends the trimmed text, so btrim(p_reason) is never empty.",
    },
  },
  block_user_and_settle: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    job_not_found: { reason: LADDER_AFTER_CANCEL },
    not_authorized: { reason: `${LADDER_AFTER_CANCEL} The loop calls it only when customer_id = auth.uid().` },
    job_not_cancelled: { reason: `${LADDER_AFTER_CANCEL} It skips a row the UPDATE did not change.` },
  },
  poster_cancel_job: {
    job_not_cancelled: { reason: LADDER_AFTER_CANCEL },
  },
  admin_reverse_violation: {
    reason_required: {
      reason: "UserAuditLog refuses to submit unless reason.trim() is non-empty and sends the trimmed text.",
    },
  },
  apply_low_rating_flag: {
    not_authenticated: { reason: `${ANON_REVOKED} The call is also fire-and-forget: CompletionPrompts only reports a failure.`, anonRevoked: true },
  },
  apply_message_violation_consequence: {
    not_authenticated: { reason: `${ANON_REVOKED} logViolation returns before calling without a user id.`, anonRevoked: true },
  },
  subscription_purchase_eligibility: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    invalid_platform: { reason: "the only call (iap.ts assertMayPurchase) passes the literal p_platform: \"apple\"." },
  },
  get_job_pets: {
    job_not_found: { reason: SILENT_PET_READ },
    not_authorized: { reason: SILENT_PET_READ },
  },
};

const { calls, dynamic } = clientRpcCalls(ROOT);
const defs = latestFunctionDefs(MIGRATIONS);
const inventory = new Map<string, Map<string, string>>();
for (const rpc of calls.keys()) {
  const codes = codesReachableFrom(rpc, defs);
  if (codes.size) inventory.set(rpc, codes);
}
const COPY = RPC_ERROR_COPY as CopyTable;
const source = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

describe("the inventory still sees the world", () => {
  it("finds client RPC calls and their codes, including codes raised by a nested function", () => {
    // If a parser change blinds the inventory, every other test here passes
    // on an empty set. These are floors, not snapshots.
    expect(calls.size).toBeGreaterThan(50);
    expect(inventory.size).toBeGreaterThan(15);
    expect(inventory.get("helper_abort_job")?.get("not_abortable")).toBe("helper_abort_job");
    expect(inventory.get("helper_abort_job")?.get("job_already_completed")).toBe("open_dispute_as");
  });

  it("no RPC is called with a name the inventory cannot read", () => {
    expect(dynamic, "a non-literal .rpc(name) hides that RPC's codes from this guard").toEqual([]);
  });

  it("a call quoted in a comment is not a call", () => {
    // Signup.tsx explains, in a comment, why it no longer calls process_referral.
    expect(calls.has("process_referral")).toBe(false);
  });
});

describe("every code a client-called RPC raises has copy at its call site", () => {
  it("every (rpc, code) is mapped in RPC_ERROR_COPY or allowlisted with a reason", () => {
    const unmapped = findUnmapped(inventory, COPY, UNREACHABLE);
    expect(
      unmapped,
      "Add plain, specific copy to RPC_ERROR_COPY in src/lib/lifecycleErrors.ts (never role-based; done is final), " +
        "or, only if no client can reach it from that call site, an UNREACHABLE entry here saying why.",
    ).toEqual([]);
  });

  it("every call site of an RPC with copy reads it through rpcErrorMessage / rpcErrorCode", () => {
    expect(findUnwired(calls, COPY, source)).toEqual([]);
  });

  it("no copy or allowlist entry names a code the RPC does not raise, or an RPC no client calls", () => {
    const stale: string[] = [];
    for (const [table, entries] of [["RPC_ERROR_COPY", COPY], ["UNREACHABLE", UNREACHABLE]] as const) {
      for (const [rpc, codes] of Object.entries(entries)) {
        if (!calls.has(rpc)) stale.push(`${table}.${rpc}: no client calls this RPC`);
        for (const code of Object.keys(codes)) {
          if (!inventory.get(rpc)?.has(code)) stale.push(`${table}.${rpc}.${code}: not raised by ${rpc}'s latest definition`);
        }
      }
    }
    for (const [rpc, codes] of Object.entries(UNREACHABLE)) {
      for (const code of Object.keys(codes)) if (COPY[rpc]?.[code]) stale.push(`${rpc}.${code}: both mapped and allowlisted`);
    }
    expect(stale).toEqual([]);
  });

  it("every 'EXECUTE revoked from anon' reason is true of the migrations", () => {
    const wrong: string[] = [];
    for (const [rpc, codes] of Object.entries(UNREACHABLE)) {
      for (const [code, entry] of Object.entries(codes)) {
        if (entry.anonRevoked && !anonExecuteRevoked(rpc, MIGRATIONS)) wrong.push(`${rpc}.${code}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("done is final: no copy about a completed job sends anyone to support", () => {
    const offenders = Object.entries(COPY).flatMap(([rpc, codes]) =>
      Object.entries(codes)
        .filter(([code, text]) => /completed/.test(code) && /support/i.test(text))
        .map(([code]) => `${rpc}.${code}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the checks can fail (the original bug, pinned)", () => {
  // The Cancel Job handler as it stood before this guard: its own regex for
  // the one code it knew, no shared copy.
  const ORIGINAL_ACTIVE_JOB_SECTION = `
    const handleAbort = async () => {
      const { data, error } = await supabase.rpc("helper_abort_job", { p_job_id: id, p_reason: r });
      if (error) {
        toast.error(
          /not_abortable/.test(error.message)
            ? "This job has already moved on — pull to refresh and take another look."
            : "We couldn’t send that — check your connection and try again.",
        );
      }
    };`;

  it("an RPC code with no copy and no allowlist entry is reported", () => {
    const withoutCompleted: CopyTable = {
      ...COPY,
      helper_abort_job: { not_abortable: "This job has already moved on — pull to refresh and take another look." },
    };
    const onlyAbort = new Map([["helper_abort_job", inventory.get("helper_abort_job")!]]);
    expect(findUnmapped(onlyAbort, withoutCompleted, UNREACHABLE)).toContain(
      "helper_abort_job: 'job_already_completed' (raised by open_dispute_as)",
    );
  });

  it("a call site that matches codes inline instead of reading the shared copy is reported", () => {
    const file = "src/components/activity/appliedJobCard/ActiveJobSection.tsx";
    const sites = new Map([["helper_abort_job", [{ file, line: 3 }]]]);
    expect(findUnwired(sites, COPY, () => ORIGINAL_ACTIVE_JOB_SECTION)).toEqual([
      `${file}:3 calls helper_abort_job 1x but reads its copy 0x`,
    ]);
  });

  it("a second call added beside a wired one is reported", () => {
    const text = `
      const a = await supabase.rpc("mark_helper_arrival", {});
      toast.error(rpcErrorMessage("mark_helper_arrival", a.error) ?? "x");
      const b = await supabase.rpc("mark_helper_arrival", {});
      toast.error("Couldn't mark you arrived — try again?");`;
    const sites = new Map([["mark_helper_arrival", [{ file: "f.tsx", line: 2 }, { file: "f.tsx", line: 4 }]]]);
    const copy: CopyTable = { mark_helper_arrival: { job_not_found: "This job no longer exists." } };
    expect(findUnwired(sites, copy, () => text)).toEqual(["f.tsx:2,4 calls mark_helper_arrival 2x but reads its copy 1x"]);
  });

  it("a RAISE quoted in a SQL comment is not a code, a real one is", () => {
    expect(raisedCodes("-- RAISE EXCEPTION 'quoted_in_a_comment';\nRAISE EXCEPTION 'real_code' USING HINT = 'x';")).toEqual([
      "real_code",
    ]);
    expect(raisedCodes("RAISE EXCEPTION 'job not found';")).toEqual([]);
  });
});
