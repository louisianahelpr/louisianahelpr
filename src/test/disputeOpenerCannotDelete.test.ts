/**
 * AL-007: disputes.opener_id is ON DELETE SET NULL, and a NULL opener leaves
 * a dispute nobody but an admin can act on. That state is unreachable while
 * every deletion path refuses an account party to a disputed job: an open
 * dispute sets jobs.status = 'disputed' (open_dispute_as), and
 * findActiveWork treats 'disputed' as live work. Inventory: every edge
 * function that purges an account.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts | revision_requested,disputed) | revision_requested)
 * @mutate supabase/functions/cleanup-abandoned-accounts/index.ts | .or(`customer_id.eq.${u.id},helper_id.eq.${u.id}`), | .eq("customer_id", u.id),
 * @mutate supabase/functions/admin-delete-user/index.ts | const active = await findActiveWork(supabaseAdmin, userId); | const active = { ok: true, active: false, detail: "" };
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const purgeSrc = readFileSync("supabase/functions/_shared/accountPurge.ts", "utf8");
const purgers = readdirSync("supabase/functions")
  .map((d) => `supabase/functions/${d}/index.ts`)
  .filter((f) => existsSync(f) && /\bpurgeAccount\(/.test(readFileSync(f, "utf8")));

describe("an account party to a disputed job cannot be deleted (AL-007)", () => {
  it("the inventory is real", () => {
    // delete-own-account, admin-delete-user, cleanup-abandoned-accounts (2026-09-24).
    expect(purgers.length).toBeGreaterThanOrEqual(3);
    expect(purgers).toEqual(
      expect.arrayContaining([
        "supabase/functions/delete-own-account/index.ts",
        "supabase/functions/admin-delete-user/index.ts",
      ]),
    );
  });

  it("findActiveWork counts a disputed job as live work", () => {
    const filter = purgeSrc.match(/const LIVE_STATUS_FILTER =([\s\S]*?);/)?.[1] ?? "";
    expect(filter).toMatch(/status\.in\.\([^)]*\bdisputed\b/);
  });

  it("every purging function checks it first", () => {
    const missing = purgers.filter((f) => {
      const src = readFileSync(f, "utf8");
      // cleanup-abandoned-accounts is stricter: any job row at all as poster
      // or helper skips the account, and a dispute party always has one.
      const check = Math.max(
        src.search(/await findActiveWork\(/),
        src.search(/from\("jobs"\)\.select\("id", \{ count: "exact", head: true \}\)\.or\(`customer_id\.eq\.\$\{u\.id\},helper_id\.eq\.\$\{u\.id\}`\)/),
      );
      return check < 0 || check > src.search(/\bpurgeAccount\(/);
    });
    expect(missing).toEqual([]);
  });
});
