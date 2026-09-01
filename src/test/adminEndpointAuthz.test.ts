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

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
const EXEMPT: Record<string, string> = {};

/** A server-side admin check, in any of the shapes this repo uses. */
const ADMIN_CHECK = /has_role|loadAdminIds|is_admin/;

describe("admin endpoints authorize server-side", () => {
  it("the ADMIN_ENDPOINTS list still matches what is on disk", () => {
    // Catches the case this test would otherwise miss entirely: a NEW
    // `admin-*` function that nobody added to the list above.
    const onDisk = readdirSync(FUNCTIONS_DIR)
      .filter((d) => d.startsWith("admin-"))
      .sort();
    expect(onDisk).toEqual([...ADMIN_ENDPOINTS].sort());
  });

  for (const name of ADMIN_ENDPOINTS) {
    describe(name, () => {
      const file = join(FUNCTIONS_DIR, name, "index.ts");

      it("exists", () => {
        expect(existsSync(file)).toBe(true);
      });

      it("verifies the caller is an admin", () => {
        if (EXEMPT[name]) return;
        const src = readFileSync(file, "utf8");
        expect(
          ADMIN_CHECK.test(src),
          `${name} performs privileged cross-user work but no server-side admin ` +
            `check (has_role / loadAdminIds / is_admin) appears in its source. ` +
            `Hiding the button in the UI does not stop a direct call.`,
        ).toBe(true);
      });

      it("writes an admin_audit_log row", () => {
        if (EXEMPT[name]) return;
        const src = readFileSync(file, "utf8");
        expect(
          src.includes("admin_audit_log"),
          `${name} changes another user's account but never writes ` +
            `admin_audit_log, so there is no record of who did it to whom.`,
        ).toBe(true);
      });
    });
  }
});
