import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

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

  // auth-js falls back to `statusText || \`HTTP ${status}\`` for any non-2xx
  // from GoTrue that is not JSON — a CDN, gateway or WAF page in front of
  // Supabase. A bare reason phrase is a status line, not advice.
  it.each(["Service Unavailable", "Bad Gateway", "HTTP 502", "Too Many Requests"])(
    "suppresses the bare HTTP reason phrase %s",
    (raw) => {
      expect(userFacingError(new Error(raw), FALLBACK)).toBe(FALLBACK);
    },
  );

  it("does not mistake our own copy for a status line", () => {
    // The reason phrases are anchored: a sentence that merely starts with the
    // same words is still ours.
    expect(userFacingError(new Error("Too many requests — try again in a minute."), FALLBACK))
      .toBe("Too many requests — try again in a minute.");
    expect(userFacingError(new Error("Not found — that job may have been taken down."), FALLBACK))
      .toBe("Not found — that job may have been taken down.");
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

  // Regression: these strings read as prose and name none of the words the
  // other patterns look for, so they were trusted and shown verbatim on
  // /signup (observed live 2026-09-02). They are what supabase-js throws for a
  // failed functions.invoke, so they were reachable from TipDialog,
  // JobBoostDialog, ReferralSection, AdminDisputes and SecurityTab too.
  //
  // There are THREE, and the first pass caught one. The instances are BUILT
  // rather than retyped so the strings are whatever the installed library
  // actually says: a rewording that would re-open the hole fails here instead
  // of in a toast.
  it.each(
    [
      new FunctionsFetchError(undefined),
      new FunctionsRelayError(undefined),
      new FunctionsHttpError(undefined),
    ].map((e): [string, string] => [e.name, e.message]),
  )(
    "suppresses supabase-js's %s transport wrapper",
    (_name, message) => {
      expect(userFacingError(new Error(message), FALLBACK)).toBe(FALLBACK);
    },
  );

  it("still shows deliberate edge-function copy, which is what the filter is FOR", () => {
    expect(userFacingError(new Error("This task isn't accepting applications anymore."), FALLBACK))
      .toBe("This task isn't accepting applications anymore.");
    expect(userFacingError(new Error("Too many requests — try again in a minute."), FALLBACK))
      .toBe("Too many requests — try again in a minute.");
  });

  it("ALWAYS logs the raw error, including when the fallback is shown", () => {
    // This is the half that makes suppression safe: a developer reading a bug
    // report must still be able to see what actually failed.
    const spy = vi.spyOn(console, "error");
    userFacingError(new Error('duplicate key value violates unique constraint "x"'), FALLBACK);
    expect(spy).toHaveBeenCalled();
  });
});
