// Every admin endpoint must authorize server-side AND leave an audit trail.
//
// WHY A SOURCE-TEXT TEST
// ----------------------
// The admin console hides destructive actions behind an `isAdmin` check in
// React. That is a UI affordance, not a security control: the edge functions
// are ordinary HTTPS endpoints, so anyone holding any valid user JWT can call
// `admin-delete-user` directly with curl. The only thing standing between a
// signed-in stranger and someone else's account is the check INSIDE the
// function.
//
// That check is currently present in all four (verified against the live DB
// during the 2026-08-25 admin audit: each one calls `has_role(_user_id, 'admin')`
// with the service-role client and refuses otherwise). Nothing enforced it,
// though — a new admin endpoint, or a refactor that moves the guard into a
// branch that an early `return` skips, would be invisible until someone tried
// it. There is no integration test that can catch this either: these are Deno
// functions talking to a live Postgres, so they do not run under vitest, and a
// test that needed real credentials could not run in CI at all.
//
// So this is deliberately blunt: it reads the source and asserts the two
// markers are present. It cannot prove the guard is correctly PLACED — only
// that someone has not shipped an admin endpoint with no guard at all, which
// is the failure that actually happens.
//
// Adding an admin endpoint? Add it here. If it genuinely needs no admin check,
// say why in EXEMPT rather than deleting the entry, so the decision is on the
// record.

//
// COVERAGE LIMIT, on the record: this reads the repo, not the live project. A
// deployed function whose guard was edited in the Supabase dashboard, or a
// function deployed from a branch, is invisible here. The 2026-08-25 admin
// audit verified the live side once by hand; nothing re-verifies it.
//
// @mutate supabase/functions/admin-delete-user/index.ts | await supabaseAdmin.rpc("has_role", { | await supabaseAdmin.rpc("not_a_role_check", {
// @mutate supabase/functions/admin-delete-user/index.ts | await supabaseAdmin.from("admin_audit_log").insert({ | await supabaseAdmin.from("some_other_table").insert({
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FUNCTIONS_DIR = "supabase/functions";

/**
 * Endpoints that act on OTHER users' data with admin privilege.
 *
 * Derived from the `admin-` prefix, plus any function whose whole purpose is a
 * privileged cross-user mutation. Kept explicit rather than inferred so that
 * renaming a function cannot silently drop it out of the check.
 */
const ADMIN_ENDPOINTS = [
  "admin-delete-user",
  "admin-resend-verification",
  // The "Send Test Push to Me" button on Admin Health. It is the narrowest
  // endpoint in this list and it is still listed, because it is the one that
  // holds the service-role key on the caller's behalf: it re-checks
  // `has_role(caller, 'admin')` server-side and only then calls
  // `send-push-notification` — which requires the service-role bearer and must
  // never be reachable with a user JWT — on the server side of the wire.
  //
  // Its target is ALWAYS the caller's own user id, read from the verified JWT;
  // no user_id is accepted from the request body and the title/body are fixed
  // in the function. So it cannot be turned into "push arbitrary Helpr-branded
  // copy at an arbitrary user", which is exactly what relaxing
  // send-push-notification's own gate would have created.
  "admin-test-push",
  "admin-update-email",
  "admin-user-actions",
];

/**
 * Admin-named endpoints that intentionally do NOT check admin, with the reason.
 * Empty today — every one of them checks.
 */
// @two-way src/test/adminEndpointAuthz.test.ts:const staleExempt =
const EXEMPT: Record<string, string> = {};

/**
 * A server-side admin check, in any of the shapes this repo uses.
 *
 * THE CALL, not the word. This was `/has_role|loadAdminIds|is_admin/` over the
 * raw source, and every one of these files says `has_role` three times: once in
 * a `//` comment explaining the check, once in the call, once inside the
 * `console.error("[fn] has_role check failed:")` string. Proven 2026-09-20 by
 * replacing admin-delete-user's entire RPC call with `const isAdmin = true` —
 * an endpoint that deletes any account for any caller holding any valid JWT —
 * and the guard stayed 16/16 green, satisfied by the comment above the hole it
 * left. Comments and string literals are stripped below and the marker must be
 * a real call, so the word alone no longer counts.
 */
const ADMIN_CHECK = /\.rpc\(\s*["'`](?:has_role|is_admin)["'`]|\bloadAdminIds\s*\(/;

/** The audit write, not the table's name in a comment or an error string. */
const AUDIT_WRITE = /\.from\(\s*["'`]admin_audit_log["'`]\s*\)/;

/**
 * Drop `//` and block comments so a marker only counts where it is EXECUTED.
 *
 * Was two deleting regexes. The `[^:]` was a partial patch for exactly the
 * right worry — `https://…` inside a string eating its line — applied to only
 * one of the two ways it goes wrong. The block-comment half has the same
 * blindness and no patch: a `/` + `*` inside a string or regex literal opens a
 * comment that runs to the next `*` + `/` anywhere later in the file and takes
 * everything between. Measured 2026-09-21, that chain makes 157 of 1,054
 * source files lose REAL CODE; one edge function loses 98% of its own.
 *
 * For THIS guard the failure mode is the dangerous direction: it searches edge
 * functions for an authorization marker, and a file whose authz check has been
 * deleted by the stripper reads as "marker absent" — or, worse, a file emptied
 * around the marker reads as whatever survives. A scanner that knows whether
 * it is inside a string before it looks at a `/` cannot be fooled either way.
 */
function codeOnly(src: string): string {
  return blankComments(src);
}

describe("admin endpoints authorize server-side", () => {
  it("the ADMIN_ENDPOINTS list still matches what is on disk", () => {
    // Catches the case this test would otherwise miss entirely: a NEW
    // `admin-*` function that nobody added to the list above.
    const onDisk = readdirSync(FUNCTIONS_DIR)
      .filter((d) => d.startsWith("admin-"))
      .sort();
    expect(onDisk).toEqual([...ADMIN_ENDPOINTS].sort());
  });

  it("EXEMPT only excuses endpoints that exist and still lack a check", () => {
    // TWO-WAY: an exemption for a removed endpoint, or one that now carries
    // BOTH markers, excuses nothing and would silently excuse a future regression.
    const staleExempt = Object.keys(EXEMPT).filter((name) => {
      const file = join(FUNCTIONS_DIR, name, "index.ts");
      if (!ADMIN_ENDPOINTS.includes(name) || !existsSync(file)) return true;
      const src = codeOnly(readFileSync(file, "utf8"));
      return ADMIN_CHECK.test(src) && AUDIT_WRITE.test(src);
    });
    expect(staleExempt.map((n) => `stale baseline entry ${n} — remove it (lower the baseline)`)).toEqual([]);
  });

  for (const name of ADMIN_ENDPOINTS) {
    describe(name, () => {
      const file = join(FUNCTIONS_DIR, name, "index.ts");

      it("exists", () => {
        expect(existsSync(file)).toBe(true);
      });

      it("verifies the caller is an admin", () => {
        if (EXEMPT[name]) return;
        const src = codeOnly(readFileSync(file, "utf8"));
        expect(
          ADMIN_CHECK.test(src),
          `${name} performs privileged cross-user work but no server-side admin ` +
            `check is CALLED in its source (.rpc("has_role") / .rpc("is_admin") / ` +
            `loadAdminIds()). Comments and log strings that mention has_role do not ` +
            `count. Hiding the button in the UI does not stop a direct call.`,
        ).toBe(true);
      });

      it("writes an admin_audit_log row", () => {
        if (EXEMPT[name]) return;
        const src = codeOnly(readFileSync(file, "utf8"));
        expect(
          AUDIT_WRITE.test(src),
          `${name} changes another user's account but never writes ` +
            `admin_audit_log (no .from("admin_audit_log")), so there is no record ` +
            `of who did it to whom. Naming the table in a comment is not a write.`,
        ).toBe(true);
      });
    });
  }
});
