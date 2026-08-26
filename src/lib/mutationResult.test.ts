import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./errorLogger", () => ({ report: vi.fn() }));

import { report } from "./errorLogger";
import {
  unwrapMutation,
  unwrapMutationRow,
  isWriteRejected,
  mutationErrorMessage,
  WriteRejectedError,
  MissingRowCountError,
} from "./mutationResult";

const reported = report as unknown as ReturnType<typeof vi.fn>;

describe("unwrapMutation", () => {
  beforeEach(() => reported.mockClear());

  it("returns the affected rows when at least one came back", () => {
    const rows = unwrapMutation({ data: [{ id: "a" }], error: null }, { action: "cancel this job" });
    expect(rows).toEqual([{ id: "a" }]);
    expect(reported).not.toHaveBeenCalled();
  });

  it("rethrows a real Supabase error, exactly like unwrap()", () => {
    expect(() =>
      unwrapMutation({ data: null, error: { message: "network down" } }, { action: "cancel this job" }),
    ).toThrow("network down");
  });

  it("preserves the PostgREST code on a real Supabase error", () => {
    const supabaseError = { message: "denied", code: "42501" };
    let caught: unknown;
    try {
      unwrapMutation({ data: null, error: supabaseError }, { action: "ban this account" });
    } catch (e) {
      caught = e;
    }
    expect((caught as Record<string, unknown>).code).toBe("42501");
  });

  it("throws WriteRejectedError when the write matched zero rows", () => {
    let caught: unknown;
    try {
      unwrapMutation({ data: [], error: null }, { action: "release this payment" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WriteRejectedError);
    expect((caught as WriteRejectedError).rowsAffected).toBe(0);
    expect((caught as WriteRejectedError).rowsExpected).toBe(1);
  });

  it("reports a silent rejection so it is visible in production", () => {
    expect(() =>
      unwrapMutation({ data: [], error: null }, { action: "release this payment", context: { jobId: "j1" } }),
    ).toThrow(WriteRejectedError);

    expect(reported).toHaveBeenCalledTimes(1);
    const [err, opts] = reported.mock.calls[0];
    expect(err).toBeInstanceOf(WriteRejectedError);
    expect(opts.tags.kind).toBe("mutation_rejected");
    expect(opts.context).toMatchObject({ action: "release this payment", rowsAffected: 0, jobId: "j1" });
  });

  it("throws MissingRowCountError when the caller forgot .select()", () => {
    let caught: unknown;
    try {
      unwrapMutation({ data: null, error: null }, { action: "approve this credential" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MissingRowCountError);
    expect((caught as Error).message).toMatch(/add \.select\("id"\)/);
    expect(reported.mock.calls[0][1].tags.kind).toBe("mutation_missing_select");
  });

  it("honours a min above 1", () => {
    expect(() =>
      unwrapMutation({ data: [{ id: "a" }], error: null }, { action: "notify both parties", min: 2 }),
    ).toThrow(WriteRejectedError);
    expect(
      unwrapMutation({ data: [{ id: "a" }, { id: "b" }], error: null }, { action: "notify both parties", min: 2 }),
    ).toHaveLength(2);
  });

  it("does not report on the success path", () => {
    unwrapMutation({ data: [{ id: "a" }], error: null }, { action: "save this profile" });
    expect(reported).not.toHaveBeenCalled();
  });
});

describe("unwrapMutationRow", () => {
  beforeEach(() => reported.mockClear());

  it("returns the single row rather than an array", () => {
    expect(unwrapMutationRow({ data: [{ id: "a" }], error: null }, { action: "save this profile" })).toEqual({
      id: "a",
    });
  });

  it("still throws when nothing was affected", () => {
    expect(() => unwrapMutationRow({ data: [], error: null }, { action: "save this profile" })).toThrow(
      WriteRejectedError,
    );
  });
});

describe("mutationErrorMessage", () => {
  beforeEach(() => reported.mockClear());

  it("uses the default human sentence built from the action", () => {
    try {
      unwrapMutation({ data: [], error: null }, { action: "cancel this job" });
    } catch (e) {
      expect(mutationErrorMessage(e)).toBe(
        "Couldn't cancel this job — it may have already changed. Refresh and try again.",
      );
    }
  });

  it("prefers caller-supplied copy for a rejection", () => {
    try {
      unwrapMutation(
        { data: [], error: null },
        { action: "cancel this job", rejectedMessage: "This job was already cancelled." },
      );
    } catch (e) {
      expect(mutationErrorMessage(e)).toBe("This job was already cancelled.");
    }
  });

  it("falls back for transport errors instead of leaking a raw code", () => {
    expect(mutationErrorMessage(Object.assign(new Error("PGRST301"), { code: "PGRST301" }))).toBe(
      "Couldn't save that change — please try again.",
    );
  });

  it("never returns a raw code for a missing-select programmer bug", () => {
    expect(mutationErrorMessage(new MissingRowCountError("x"), "Something went wrong.")).toBe(
      "Something went wrong.",
    );
  });
});

describe("isWriteRejected", () => {
  it("distinguishes a silent rejection from any other error", () => {
    expect(isWriteRejected(new WriteRejectedError("nope", 0, 1))).toBe(true);
    expect(isWriteRejected(new Error("network down"))).toBe(false);
    expect(isWriteRejected(new MissingRowCountError("x"))).toBe(false);
    expect(isWriteRejected(null)).toBe(false);
  });
});
