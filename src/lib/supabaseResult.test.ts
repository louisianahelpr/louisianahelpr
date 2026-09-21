import { describe, it, expect } from "vitest";
import { unwrap, functionErrorMessage, functionErrorBody } from "./supabaseResult";

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

/*
 * functionErrorMessage / functionErrorBody had NO coverage at all until
 * 2026-09-21, despite 10+ call sites including InstantPayoutDialog, TipDialog,
 * JobBoostDialog and SubscriptionTab.
 *
 * They exist because a failed `functions.invoke` arrives as a FunctionsHttpError
 * whose `.message` is always the generic "Edge Function returned a non-2xx
 * status code". The reason the user actually needs — and the machine-readable
 * flags that let a refusal offer the one tap that fixes it — are only in the
 * JSON body. If these silently start returning the fallback, every edge-function
 * refusal in the app degrades to "please try again" and nothing fails.
 */

/** A FunctionsHttpError-shaped object: the SDK hangs the raw Response off .context */
const invokeError = (body: unknown, ok = false) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  }),
});

describe("functionErrorMessage", () => {
  it("recovers the real reason from the JSON body", async () => {
    const err = invokeError({ error: "You already boosted this job today." });
    await expect(functionErrorMessage(err)).resolves.toBe("You already boosted this job today.");
  });

  it("falls back when the body carries no error string", async () => {
    await expect(functionErrorMessage(invokeError({ ok: true }))).resolves.toMatch(/please try again/i);
  });

  it("falls back when the error string is only whitespace", async () => {
    // A blank toast is worse than a generic one — it reads as a silent failure.
    await expect(functionErrorMessage(invokeError({ error: "   " }))).resolves.toMatch(/please try again/i);
  });

  it("falls back when the body is not JSON", async () => {
    await expect(functionErrorMessage(invokeError("<html>502 Bad Gateway</html>"))).resolves.toMatch(
      /please try again/i,
    );
  });

  it("falls back when there is no Response context at all (network error, thrown string)", async () => {
    await expect(functionErrorMessage(new Error("Failed to fetch"))).resolves.toMatch(/please try again/i);
    await expect(functionErrorMessage(null)).resolves.toMatch(/please try again/i);
    await expect(functionErrorMessage("just a string")).resolves.toMatch(/please try again/i);
  });

  it("uses the caller's fallback when one is given", async () => {
    await expect(functionErrorMessage(invokeError({ ok: true }), "Payout failed.")).resolves.toBe(
      "Payout failed.",
    );
  });

  it("NEVER returns the raw SDK string to a user", async () => {
    // The whole point of the helper: this sentence must not reach a toast.
    for (const e of [invokeError({ ok: true }), invokeError("nope"), new Error("x")]) {
      await expect(functionErrorMessage(e)).resolves.not.toMatch(/non-2xx status code/i);
    }
  });
});

describe("functionErrorBody", () => {
  it("returns the whole body, so callers can read the actionable flags", async () => {
    const err = invokeError({ error: "Onboarding fee due", needsOnboardingFee: true });
    await expect(functionErrorBody(err)).resolves.toEqual({
      error: "Onboarding fee due",
      needsOnboardingFee: true,
    });
  });

  it("returns null when the body is not JSON", async () => {
    await expect(functionErrorBody(invokeError("<html>502</html>"))).resolves.toBeNull();
  });

  it("returns null when there is no Response context", async () => {
    await expect(functionErrorBody(new Error("Failed to fetch"))).resolves.toBeNull();
    await expect(functionErrorBody(undefined)).resolves.toBeNull();
  });

  it("BOTH helpers can read the SAME error — the body is cloned, not consumed", async () => {
    // A Response body is a one-shot stream. Several call sites ask for the
    // sentence AND the flags from one error (AwardGateDialog, SubscriptionTab).
    // Without .clone() the second reader gets nothing and the refusal loses
    // either its copy or its one-tap resolution.
    const err = invokeError({ error: "Attempt limit reached", attemptLimitReached: true });
    await expect(functionErrorMessage(err)).resolves.toBe("Attempt limit reached");
    await expect(functionErrorBody(err)).resolves.toEqual({
      error: "Attempt limit reached",
      attemptLimitReached: true,
    });
    // And again, in the other order, from the same Response.
    await expect(functionErrorBody(err)).resolves.toMatchObject({ attemptLimitReached: true });
    await expect(functionErrorMessage(err)).resolves.toBe("Attempt limit reached");
  });
});

// Dropping the error half is the defect this whole module exists to prevent —
// and it is the same line `error-state-sweep` targets.
// @mutate src/lib/supabaseResult.ts | if (error) { | if (false) {
// Losing the body's message degrades EVERY edge-function refusal in the app to
// "please try again", with nothing red.
// @mutate src/lib/supabaseResult.ts | if (body && typeof body.error === "string" && body.error.trim()) { | if (false) {
