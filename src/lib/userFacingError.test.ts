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
    // The engine the app SHIPS in. Every one of these passed through verbatim
    // until 2026-09-07 because the list above only knew Chromium's phrasing —
    // proven by executing the module, not by reading it.
    ["Load failed", "WebKit transport"],
    ["Network request failed", "older Safari / RN transport"],
    ["The network connection was lost.", "NSURLError prose"],
    ["The request timed out.", "NSURLError prose"],
    ["The Internet connection appears to be offline.", "NSURLError prose"],
    ["Can't find variable: subscribeToOwnProfile", "WebKit ReferenceError .message (no class prefix)"],
    ["undefined is not an object (evaluating 'a.b')", "WebKit TypeError .message"],
    ["Cannot read properties of undefined (reading 'x')", "V8 TypeError .message"],
    ["fetchJobs is not a function", "TypeError .message"],
  ])("suppresses %s (%s) in favour of the human copy", (raw) => {
    expect(userFacingError(new Error(raw), FALLBACK)).toBe(FALLBACK);
  });

  // The whole point of not hard-coding the fallback: our own edge functions
  // return deliberate copy, and replacing it would be a downgrade.
  it.each([
    "Too many requests — try again in a minute.",
    "This job isn't accepting applications anymore.",
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
    expect(userFacingError(new Error("This job isn't accepting applications anymore."), FALLBACK))
      .toBe("This job isn't accepting applications anymore.");
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
// SHOWN ABLE TO FAIL — the supabase-js transport-wrapper pattern. This one
// literal suppresses ALL THREE of FunctionsFetchError / FunctionsRelayError /
// FunctionsHttpError (they share the phrase "Edge Function" and nothing else
// this filter matches), so breaking it hands a person "Edge Function returned
// a non-2xx status code" out of a tip, a boost, a referral or a dispute —
// observed live on /signup 2026-09-02, which is why the test BUILDS the three
// error instances from the installed library instead of retyping their
// strings.
// @mutate src/lib/userFacingError.ts | /\bEdge Function\b/i, | /\bEdge Functions Are Fine\b/i,

// lh-silent-failure review of the Q228 toast sweep (2026-09-26): what the
// sweep newly routed through this helper must not lose deliberate server
// refusals, and must not let raw RPC raise text or mutationResult's
// developer messages through.
// @mutate src/lib/userFacingError.ts | const MAX_SHOWABLE = 280; | const MAX_SHOWABLE = 160;
// @mutate src/lib/userFacingError.ts |   /^[a-z][^.!?]*$/, |   /^never matches either$/,
// @mutate src/lib/userFacingError.ts |     return named.userMessage; |     return fallback;
// @mutate src/lib/userFacingError.ts |   if (named?.name === "MissingRowCountError") return fallback; |   if (named?.name === "MissingRowCountErrorX") return fallback;
describe("userFacingError after the Q228 sweep review", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    // supabase/functions/stripe-connect/index.ts (409 on reset), 181 chars
    "We couldn't reset your payout account — Stripe still has activity on it (this usually means money is waiting to pay out). Nothing was changed. Contact support and we'll sort it out.",
    // supabase/functions/create-payment/index.ts admin_refund_general on a disputed job
    "This job is under dispute. Use Quick Refund on the dispute instead — it settles the dispute and the refund together, and a general refund would race it. No money was moved.",
  ])("keeps a long deliberate server refusal: %s", (copy) => {
    expect(copy.length).toBeGreaterThan(160);
    expect(userFacingError(new Error(copy), FALLBACK)).toBe(copy);
  });

  it.each(["not_cancellable", "not authorized for this job", "job not found", "not authenticated"])(
    "drops raw RPC raise text: %s",
    (raw) => {
      // postgrest-js returns `error` as a plain object, not an Error
      expect(userFacingError({ message: raw, code: "P0001" }, FALLBACK)).toBe(FALLBACK);
    },
  );

  it("shows a zero-row write's own copy, never its developer message", () => {
    const err = Object.assign(new Error("Write affected 0 row(s), expected at least 1. Most likely RLS, a stale id, or a guard predicate that no longer holds."), {
      name: "WriteRejectedError", userMessage: "That credential was already reviewed.",
    });
    expect(userFacingError(err, FALLBACK)).toBe("That credential was already reviewed.");
  });

  it("never shows a missing-row-count developer message", () => {
    const err = Object.assign(new Error('unwrapMutation("x") received no rows array — add .select("id") to the mutation so the affected-row count is observable.'), { name: "MissingRowCountError" });
    expect(userFacingError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("uses the real mutationResult classes' names", async () => {
    const { WriteRejectedError, MissingRowCountError } = await import("@/lib/mutationResult");
    expect(userFacingError(new WriteRejectedError("Already done.", 0, 1), FALLBACK)).toBe("Already done.");
    expect(userFacingError(new MissingRowCountError("x"), FALLBACK)).toBe(FALLBACK);
  });
});
