import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { userFacingError } from "@/lib/userFacingError";

const FALLBACK = "Couldn't save that — try again?";

describe("userFacingError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // These are verbatim Postgres / PostgREST / Supabase strings. Each one was
  // reachable by a real user before this helper existed.
  it.each([
    ['new row violates row-level security policy for table "reviews"', "RLS"],
    ['duplicate key value violates unique constraint "reviews_job_id_key"', "unique violation"],
    ['insert or update on table "jobs" violates foreign key constraint "jobs_customer_id_fkey"', "FK"],
    ['relation "public.open_jobs_safe" does not exist', "dropped object"],
    ["permission denied for table jobs", "grant"],
    ["PGRST202: function not found", "PostgREST code"],
    ["Could not find the 'decline_reason' column of 'applications'", "schema cache"],
    ["jwt expired", "auth internals"],
    ["TypeError: Cannot read properties of null (reading 'toLowerCase')", "JS error"],
    ["Failed to fetch", "transport"],
  ])("suppresses %s (%s) in favour of the human copy", (raw) => {
    expect(userFacingError(new Error(raw), FALLBACK)).toBe(FALLBACK);
  });

  // The whole point of not hard-coding the fallback: our own edge functions
  // return deliberate copy, and replacing it would be a downgrade.
  it.each([
    "Too many requests — try again in a minute.",
    "This task isn't accepting applications anymore.",
    "You can't apply to your own post.",
    "That code didn't match. Check your app and try again.",
  ])("passes our own written copy through: %s", (raw) => {
    expect(userFacingError(new Error(raw), FALLBACK)).toBe(raw);
  });

  it("falls back when there is no message at all", () => {
    expect(userFacingError(new Error(""), FALLBACK)).toBe(FALLBACK);
    expect(userFacingError(null, FALLBACK)).toBe(FALLBACK);
    expect(userFacingError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(userFacingError({}, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back on anything too long to be a sentence", () => {
    expect(userFacingError(new Error("x".repeat(200)), FALLBACK)).toBe(FALLBACK);
  });

  it("accepts a bare string error", () => {
    expect(userFacingError("You must be logged in.", FALLBACK)).toBe("You must be logged in.");
  });

  it("ALWAYS logs the raw error, including when the fallback is shown", () => {
    // This is the half that makes suppression safe: a developer reading a bug
    // report must still be able to see what actually failed.
    const spy = vi.spyOn(console, "error");
    userFacingError(new Error('duplicate key value violates unique constraint "x"'), FALLBACK);
    expect(spy).toHaveBeenCalled();
  });
});
