import { describe, it, expect } from "vitest";
import { unwrap } from "./supabaseResult";

describe("unwrap", () => {
  it("returns the data half when there is no error", () => {
    expect(unwrap({ data: [1, 2, 3], error: null })).toEqual([1, 2, 3]);
  });

  it("returns falsy data unchanged as long as error is null", () => {
    expect(unwrap({ data: null, error: null })).toBeNull();
    expect(unwrap({ data: 0, error: null })).toBe(0);
  });

  it("throws when the result carries an error", () => {
    expect(() => unwrap({ data: null, error: { message: "boom" } })).toThrow("boom");
  });

  it("throws a real Error instance so downstream instanceof checks pass", () => {
    let caught: unknown;
    try {
      unwrap({ data: null, error: { message: "network down" } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("network down");
  });

  it("preserves extra Supabase error fields (code / details / hint)", () => {
    // A plain object rather than a literal at the call site, so the extra
    // PostgREST fields don't trip TS's excess-property check.
    const supabaseError = { message: "bad request", code: "PGRST116", hint: "check filter" };
    let caught: unknown;
    try {
      unwrap({ data: null, error: supabaseError });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Record<string, unknown>).code).toBe("PGRST116");
    expect((caught as Record<string, unknown>).hint).toBe("check filter");
  });

  it("re-throws an existing Error instance unchanged rather than re-wrapping it", () => {
    const original = new Error("already an error");
    let caught: unknown;
    try {
      unwrap({ data: null, error: original });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(original);
  });
});
