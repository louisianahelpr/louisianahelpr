import { afterEach, describe, it, expect, vi } from "vitest";
import {
  RPC_ERROR_COPY,
  codeNamedIn,
  isExpectedLifecycleRefusal,
  lifecycleErrorMessage,
  loadAdminRpcErrorCopy,
  rpcErrorCode,
  rpcErrorMessage,
} from "./lifecycleErrors";
import { WriteRejectedError } from "./mutationResult";

describe("rpcErrorMessage", () => {
  it("a Cancel job that lands after the job was marked complete says so, not 'check your connection'", () => {
    // PostgREST hands the RAISE text back as the message, verbatim.
    const err = { code: "P0001", message: "job_already_completed", hint: "Once a job is marked done it is final." };
    expect(rpcErrorCode("helper_abort_job", err)).toBe("job_already_completed");
    expect(rpcErrorMessage("helper_abort_job", err)).toBe("This job was just marked complete, so it can't be cancelled.");
  });

  it("the same code reads differently behind a different door", () => {
    const err = { message: "job_already_completed" };
    expect(rpcErrorMessage("rpc_open_dispute", err)).toBe("This job is finished, so it can't be disputed.");
    expect(rpcErrorMessage("helper_abort_job", err)).not.toMatch(/disput/i);
  });

  it("matches whole codes only, and returns null for anything it has no words for", () => {
    expect(rpcErrorCode("poster_cancel_job", { message: "not_authorized_extra" })).toBeNull();
    expect(rpcErrorMessage("helper_abort_job", { message: "new row violates row-level security policy" })).toBeNull();
    expect(rpcErrorMessage("helper_abort_job", null)).toBeNull();
    expect(rpcErrorMessage("apply_to_job", "rate_limit_day")).toBe("You've hit today's application limit — check back tomorrow.");
  });
});

// Proof this guard can fail (scripts/vacuity). The defect this file exists to
// stop is a lifecycle refusal shown as the WRONG sentence: the whole-token
// match is the only thing keeping `not_authorized` from firing on a longer
// code that merely contains it, which is how "Only the person who posted this
// job can cancel it" ends up on a refusal that meant something else.
// @mutate src/lib/lifecycleErrors.ts | if (new RegExp(`(^\|[^a-z0-9_])${code}($\|[^a-z0-9_])`).test(raw)) return code; | if (raw.includes(code)) return code;

// The readers beside the RPC tables (coverage floor, #3685): the zero-row write's own
// sentence, the designed-refusal check, whole-token matching, and the admin copy loaded on demand.
// @mutate src/lib/lifecycleErrors.ts |   if (isWriteRejected(error)) return error.userMessage; |
describe("lifecycleErrorMessage", () => {
  it("a zero-row write shows its own sentence, before any code is looked at", () => {
    const e = new WriteRejectedError("This job changed while you were looking. Refresh and try again.", 0, 1);
    expect(lifecycleErrorMessage(e)).toBe("This job changed while you were looking. Refresh and try again.");
  });

  it("finds a code inside Postgres's own prose, from an Error or a bare string", () => {
    const words = lifecycleErrorMessage("refund_request_live");
    expect(words).toMatch(/refund request on this job/);
    expect(lifecycleErrorMessage(new Error('P0001: refund_request_live (raised by trg_refuse_job_move)'))).toBe(words);
    expect(lifecycleErrorMessage({ message: "ERROR: refund_request_live" })).toBe(words);
  });

  it("nothing to read, or a code it has no words for, is null (the caller keeps its fallback)", () => {
    expect(lifecycleErrorMessage(null)).toBeNull();
    expect(lifecycleErrorMessage(undefined)).toBeNull();
    expect(lifecycleErrorMessage("")).toBeNull();
    expect(lifecycleErrorMessage(new Error("TypeError: Failed to fetch"))).toBeNull();
  });
});

describe("isExpectedLifecycleRefusal", () => {
  it("a settlement in progress is a designed refusal; anything else is not", () => {
    expect(isExpectedLifecycleRefusal("dispute_settlement_in_progress")).toBe(true);
    expect(isExpectedLifecycleRefusal(new Error("P0001: dispute_settlement_in_progress"))).toBe(true);
    expect(isExpectedLifecycleRefusal(new Error("refund_request_live"))).toBe(false);
    expect(isExpectedLifecycleRefusal(null)).toBe(false);
    expect(isExpectedLifecycleRefusal("")).toBe(false);
  });
});

describe("codeNamedIn, and an RPC's own table", () => {
  const codes = { not_authorized: "No.", job_not_found: "Gone." };

  it("matches a code only as a whole token", () => {
    expect(codeNamedIn(codes, "not_authorized")).toBe("not_authorized");
    expect(codeNamedIn(codes, "ERROR: job_not_found (P0001)")).toBe("job_not_found");
    expect(codeNamedIn(codes, "caller_not_authorized_for_admin")).toBeNull();
    expect(codeNamedIn(codes, "not_authorized_yet")).toBeNull();
    expect(codeNamedIn(codes, { message: null })).toBeNull();
    expect(codeNamedIn(codes, null)).toBeNull();
  });

  it("reads an RPC's own table, and nothing from another RPC's", () => {
    const rpc = "create_quote_request" as const;
    const table = RPC_ERROR_COPY[rpc] as Record<string, string>;
    const code = Object.keys(table)[0];
    expect(Object.keys(table).length).toBeGreaterThan(3);
    expect(rpcErrorCode(rpc, new Error(code))).toBe(code);
    expect(rpcErrorMessage(rpc, new Error(code))).toBe(table[code]);
    expect(rpcErrorMessage(rpc, new Error("a_code_no_table_has"))).toBeNull();
  });
});

describe("loadAdminRpcErrorCopy", () => {
  afterEach(() => {
    vi.doUnmock("@/components/admin/adminRpcErrorCopy");
    vi.resetModules();
  });

  it("resolves the admin copy module on demand", async () => {
    const mod = await loadAdminRpcErrorCopy();
    expect(mod).not.toBeNull();
    expect(typeof mod).toBe("object");
  });

  it("resolves null (never throws) when the chunk cannot be fetched", async () => {
    vi.resetModules();
    vi.doMock("@/components/admin/adminRpcErrorCopy", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const fresh = await import("./lifecycleErrors");
    await expect(fresh.loadAdminRpcErrorCopy()).resolves.toBeNull();
  });
});
