/**
 * Q1195 — error_logs keeps the PostgREST code and status of an unwrap()'d
 * Supabase error.
 *
 * WHAT WAS BROKEN (read in source, 2026-10-03): describeUnknownError returned
 * `err.message` for any Error and appended code/details/hint/status only for a
 * plain object. unwrap() throws an Error COPY carrying those fields, so every
 * read reported through the query cache logged no PostgREST code, and a
 * refused HEAD count (its message is "") logged an empty message.
 *
 * Checked before changing the format (prod, read-only SQL, 2026-10-04): the
 * alert ledger titles a client row by split_part(message, ' — ', 1)
 * (ops_alert_ledger_from_error_log, ops_alert_verify), so the fields go after
 * " — " and that title is unchanged; Sentry/PostHog get the raw Error, not
 * this string.
 */
import { describe, it, expect, vi } from "vitest";
import { report, _describeUnknownError } from "./errorLogger";
import { unwrap } from "./supabaseResult";

const fetchSpy = vi.hoisted(() => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })));
vi.stubGlobal("fetch", fetchSpy);
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

/** What unwrap() throws for a refused read: PostgREST's 42501 at HTTP 403. */
function unwrapped(message: string): unknown {
  try {
    unwrap({ data: null, error: { message, code: "42501", details: null, hint: null } as { message: string }, status: 403 });
  } catch (e) {
    return e;
  }
  throw new Error("unwrap did not throw");
}

describe("Q1195: an unwrap()'d Supabase error keeps its PostgREST fields in error_logs", () => {
  it("report() logs code=42501 and status=403 for a refused read", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
    fetchSpy.mockClear();
    report(unwrapped("permission denied for table jobs"), { tags: { source: "query" } });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 3000 });
    const row = JSON.parse(String(fetchSpy.mock.calls[0][1].body))[0] as { message: string };
    expect(row.message).toContain("code=42501");
    expect(row.message).toContain("status=403");
    // The alert ledger's title for this row is unchanged.
    expect(row.message.split(" — ")[0]).toBe("permission denied for table jobs");
  });

  it("a refused HEAD count (empty message) no longer logs an empty message", () => {
    const msg = _describeUnknownError(unwrapped(""));
    expect(msg).toBe("code=42501 · status=403");
  });

  it("a plain Error is logged exactly as before", () => {
    expect(_describeUnknownError(new Error("boom"))).toBe("boom");
    expect(_describeUnknownError(new Error("Error screen shown: Jobs"))).toBe("Error screen shown: Jobs");
  });

  it("a plain error object keeps its old format", () => {
    expect(_describeUnknownError({ message: "nope", code: "PGRST116" })).toBe("nope · code=PGRST116");
  });
});

// @mutate src/lib/errorLogger.ts |     if (!fields.length) return err.message; |     return err.message;
// @mutate src/lib/errorLogger.ts |     return err.message ? `${err.message} — ${fields.join(" · ")}` : fields.join(" · "); |     return err.message ? `${err.message} · ${fields.join(" · ")}` : fields.join(" · ");
