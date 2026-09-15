/**
 * EF-5 (hole hunt 2026-09-15): the top-level catch of several handlers returned
 * the raw `err.message` / `String(err)` / raw upstream body to the caller,
 * handing Stripe/PostgREST schema and integration detail to an unauthenticated
 * client. The fix returns a fixed client-safe string and keeps the detail in
 * `console.error`.
 *
 * This guards the SIX handlers this change owns. `create-payment` and
 * `execute-dispute-split` are the two other EF-5 sites; they are owned by other
 * branches and deliberately NOT asserted here.
 *
 * Each entry pins the EXACT leak fragment the pre-fix source shipped, so the
 * test is genuinely red on origin/main (the fragment is present) and green now
 * (the fragment is gone). A generic regex was avoided because `err.message` is
 * legitimately read in `console.error`/`isStaleAccountErr` — only the leak into
 * a Response body is a defect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** function name → the raw-error fragments that must no longer appear. */
const LEAKS: Record<string, string[]> = {
  "stripe-connect": ["JSON.stringify({ error: err.message })"],
  "admin-user-actions": ["JSON.stringify({ error: (err as Error).message })"],
  "admin-resend-verification": ["JSON.stringify({ error: (err as Error).message })"],
  "stripe-idv-start": ["JSON.stringify({ error: (err as Error).message })"],
  "send-marketing-blast": ['JSON.stringify({ error: e.message || "Unknown error" })'],
  "ai-job-builder": [
    'error: e instanceof Error ? e.message : "Unknown error"',
    "${t.slice(0, 200)}",
  ],
};

describe("EF-5 · handlers do not echo raw internal error text", () => {
  for (const [name, fragments] of Object.entries(LEAKS)) {
    it(`${name} returns a generic message, not the raw caught error`, () => {
      const src = readFileSync(
        resolve(process.cwd(), `supabase/functions/${name}/index.ts`),
        "utf8",
      );
      for (const frag of fragments) {
        expect(src, `${name} still leaks: ${frag}`).not.toContain(frag);
      }
      // And the catch still logs the detail server-side (never silently dropped).
      expect(src).toMatch(/console\.error\(/);
    });
  }
});
