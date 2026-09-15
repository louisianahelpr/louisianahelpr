import { describe, it, expect } from "vitest";
import { rpcErrorCode, rpcErrorMessage } from "./lifecycleErrors";

describe("rpcErrorMessage", () => {
  it("a Cancel Job that lands after the job was marked complete says so, not 'check your connection'", () => {
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
