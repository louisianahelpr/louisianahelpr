// Q2305 (lh-authz-rls review of the You-list Admin row, 2026-10-21): public.user_roles is the
// table that makes an account an admin. Its RLS policies held, but anon and authenticated still
// had table-level INSERT, UPDATE and DELETE (Supabase's default GRANT ALL), so one mistaken policy
// would have let a member grant themselves admin. 20261021184118_user_roles_table_grants.sql takes everything from anon
// and leaves authenticated only what the app uses: SELECT (useCurrentUser's own-role read, the admin
// lists) and DELETE (AdminSettings' removeAdmin; granting admin goes through admin-user-actions as
// service_role). PGlite proof: src/test/pglite/userRolesTableGrants.pglite.mjs.
//
// This replays every migration in order: CREATE TABLE public.user_roles starts both client roles at
// Supabase's default (every privilege), then each GRANT / REVOKE on the table (alone, quoted or in a
// list of tables) or on ALL TABLES IN SCHEMA public is applied. A GRANT to PUBLIC counts for both
// client roles; a REVOKE from PUBLIC removes neither role's own grant, exactly as in Postgres.
// Comments never count (blankSqlComments). ALL includes
// Postgres 17's MAINTAIN: prod's relacl showed it on both client roles (anon=arwdxm), so a revoke
// that names privileges one by one leaves it behind and this guard says so.
//
// @mutate supabase/migrations/20261021184118_user_roles_table_grants.sql | REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon; | REVOKE ALL ON TABLE public.user_roles FROM PUBLIC;
// @mutate supabase/migrations/20261021184118_user_roles_table_grants.sql | REVOKE ALL ON TABLE public.user_roles FROM authenticated; | REVOKE UPDATE ON TABLE public.user_roles FROM authenticated;
// @mutate supabase/migrations/20261021184118_user_roles_table_grants.sql | REVOKE ALL ON TABLE public.user_roles FROM authenticated; | REVOKE INSERT, UPDATE, REFERENCES, TRUNCATE, TRIGGER ON TABLE public.user_roles FROM authenticated;
// @mutate supabase/migrations/20261021184118_user_roles_table_grants.sql | GRANT SELECT, DELETE ON TABLE public.user_roles TO authenticated; | GRANT SELECT, DELETE, INSERT ON TABLE public.user_roles TO authenticated;
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const CLIENT_ROLES = ["anon", "authenticated"] as const;

function parsePrivs(list: string): string[] {
  const t = list.trim().toUpperCase();
  if (/^ALL(\s+PRIVILEGES)?$/.test(t)) return ALL;
  return t.split(",").map((s) => s.trim().split(/\s|\(/)[0]).filter(Boolean);
}

/** The client roles' table privileges on public.user_roles after every migration, and the statements (file: role) that touched them. */
function userRolesGrants(dir = MIG): { privs: Record<string, Set<string>>; statements: string[] } {
  const privs: Record<string, Set<string>> = { anon: new Set(), authenticated: new Set() };
  const statements: string[] = [];
  let created = false;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    const re = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?user_roles"?(?=[\s(])|\b(GRANT|REVOKE)\s+([A-Z ,()_]+?)\s+ON\s+(?:TABLE\s+)?([^;]+?)\s+(TO|FROM)\s+([^;]+);/gi;
    for (const m of sql.matchAll(re)) {
      if (!m[1]) {
        if (!created) for (const r of CLIENT_ROLES) privs[r] = new Set(ALL);
        created = true;
        statements.push(`${f}: CREATE TABLE`);
        continue;
      }
      const allTables = /^ALL\s+TABLES\s+IN\s+SCHEMA\s+"?public"?$/i.test(m[3].trim());
      const names = m[3].split(",").map((t) => t.trim().toLowerCase().replace(/"/g, "").replace(/^public\./, ""));
      if (!allTables && !names.includes("user_roles")) continue;
      if (!created && !allTables) continue;
      const grant = m[1].toUpperCase() === "GRANT";
      const grantees = m[5]
        .replace(/\s+(cascade|restrict|with\s+grant\s+option|granted\s+by\s+\S+)\s*$/i, "")
        .split(",")
        .map((g) => g.trim().toLowerCase().replace(/^group\s+/, "").replace(/"/g, ""));
      const p = parsePrivs(m[2]);
      for (const r of CLIENT_ROLES) {
        if (!grantees.includes(r) && !(grant && grantees.includes("public"))) continue;
        for (const x of p) {
          if (grant) privs[r].add(x);
          else privs[r].delete(x);
        }
        statements.push(`${f}: ${m[1].toUpperCase()} ${r}`);
      }
    }
  }
  return { privs, statements };
}

describe("public.user_roles table grants (Q2305)", () => {
  const { privs, statements } = userRolesGrants();

  it("reads the table's history (inventory floor)", () => {
    // CREATE TABLE, the 2026-09-03 TRUNCATE/TRIGGER sweep (x2 roles) and Q2305's revokes and grant.
    expect(statements.length).toBeGreaterThan(4);
  });

  it("anon holds no privilege on user_roles", () => {
    expect([...privs.anon].sort()).toEqual([]);
  });

  it("authenticated holds only SELECT and DELETE (no INSERT, UPDATE, REFERENCES, TRUNCATE, TRIGGER, MAINTAIN)", () => {
    expect([...privs.authenticated].sort()).toEqual(["DELETE", "SELECT"]);
  });

  it("the model is not vacuous: a GRANT ALL after Q2305 would be seen", () => {
    // Synthetic replay over a temp copy is overkill; prove the parser on one statement instead.
    expect(parsePrivs("ALL PRIVILEGES")).toEqual(ALL);
    expect(parsePrivs("insert, update")).toEqual(["INSERT", "UPDATE"]);
  });

  it("sees a re-grant in every form a later migration could write it (lh-authz-rls review)", () => {
    const dir = mkdtempSync(join(tmpdir(), "user-roles-grants-"));
    try {
      const forms = [
        "GRANT INSERT ON public.user_roles TO PUBLIC;",
        'GRANT INSERT ON public."user_roles" TO authenticated;',
        "GRANT INSERT ON public.profiles, public.user_roles TO authenticated;",
        "GRANT INSERT ON TABLE user_roles TO GROUP authenticated;",
        "grant all on all tables in schema public to authenticated;",
      ];
      for (const form of forms) {
        for (const f of readdirSync(dir)) rmSync(join(dir, f));
        writeFileSync(join(dir, "1_create.sql"), "CREATE TABLE public.user_roles (id uuid);\n");
        writeFileSync(join(dir, "2_lock.sql"), readFileSync(join(MIG, "20261021184118_user_roles_table_grants.sql"), "utf8"));
        writeFileSync(join(dir, "3_regrant.sql"), form + "\n");
        expect(userRolesGrants(dir).privs.authenticated.has("INSERT"), form).toBe(true);
      }
      // ...and the locked state alone is what the real corpus asserts.
      rmSync(join(dir, "3_regrant.sql"));
      expect([...userRolesGrants(dir).privs.authenticated].sort()).toEqual(["DELETE", "SELECT"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
