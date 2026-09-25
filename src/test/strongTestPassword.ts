import { randomBytes } from "node:crypto";

/**
 * A password for an account a test creates on prod. Supabase Auth's policy
 * requires a lowercase letter, an uppercase letter, a digit and a symbol;
 * `randomBytes(n).toString("base64url")` alone often has no symbol, and the
 * privacy journey failed on it with 422 weak_password (run 36092612315,
 * 2026-09-25). The fixed tail guarantees every class; the random head keeps
 * it unguessable.
 */
export function strongTestPassword(): string {
  return `${randomBytes(24).toString("base64url")}aZ9!`;
}
