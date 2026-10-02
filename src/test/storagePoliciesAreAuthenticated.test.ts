/**
 * Q572: every row-level policy on storage.objects is TO authenticated.
 *
 * Measured on prod 2026-10-02: an anon POST to /storage/v1/object/list/<bucket>
 * returned HTTP 400 "permission denied for table jobs" for every bucket
 * (avatars, proof-photos, job-photos, user-documents) instead of an empty
 * answer. Postgres evaluates every policy that applies to the caller's role;
 * "Job participants can view proof photos" had no TO clause (so TO public, which
 * includes anon) and reads public.jobs, on which anon holds no SELECT. The
 * policy granted anon nothing (every branch needs auth.uid()), it only made the
 * signed-out answer an error. 20261002051450 scoped it and the one other
 * TO-public policy ("Owner upload user-documents") to authenticated.
 *
 * No signed-out path reads or writes Storage through RLS: public buckets are
 * served by the /object/public/ route, which does not consult these policies.
 * So the class rule is simple: the NEWEST definition of every storage.objects
 * policy, replayed across all migrations in order (CREATE, ALTER ... TO,
 * ALTER ... RENAME TO, DROP), names neither public nor anon. A CREATE with no
 * TO clause is TO public.
 *
 * @mutate supabase/migrations/20261002051450_storage_policies_to_authenticated.sql | ALTER POLICY "Job participants can view proof photos" ON storage.objects TO authenticated; | SELECT 1;
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const NAME = String.raw`("(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const ON_OBJECTS = String.raw`\s+ON\s+(?:"?storage"?\s*\.\s*)"?objects"?`;
const unquote = (n: string) => (n.startsWith('"') ? n.slice(1, -1).replace(/""/g, '"') : n.toLowerCase());
const roleList = (s: string) => s.split(",").map((r) => r.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);

type Policy = { roles: string[]; file: string };

/** Replays every migration's storage.objects policy DDL in timestamp order. */
function storageObjectPolicies(sources: Array<[string, string]>): Map<string, Policy> {
  const live = new Map<string, Policy>();
  const stmtRe = new RegExp(
    String.raw`\b(CREATE|ALTER|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?${NAME}${ON_OBJECTS}\b([^;]*);`,
    "gi",
  );
  for (const [file, raw] of sources) {
    const sql = blankSqlComments(raw);
    for (const m of sql.matchAll(stmtRe)) {
      const verb = m[1].toUpperCase();
      const name = unquote(m[2]);
      const rest = m[3];
      if (verb === "DROP") {
        live.delete(name);
      } else if (verb === "CREATE") {
        const to = /\bTO\s+([\w",\s]+?)(?=\s+(?:USING|WITH\s+CHECK)\b|\s*$)/i.exec(rest);
        live.set(name, { roles: to ? roleList(to[1]) : ["public"], file });
      } else {
        const rename = /^\s*RENAME\s+TO\s+("(?:[^"]|"")+"|[A-Za-z_][\w$]*)/i.exec(rest);
        const prev = live.get(name);
        if (rename) {
          live.delete(name);
          if (prev) live.set(unquote(rename[1]), { ...prev, file });
          continue;
        }
        const to = /^\s*TO\s+([\w",\s]+?)(?=\s+(?:USING|WITH\s+CHECK)\b|\s*$)/i.exec(rest);
        if (to && prev) live.set(name, { roles: roleList(to[1]), file });
      }
    }
  }
  return live;
}

const policies = storageObjectPolicies(files.map((f) => [f, readFileSync(`${DIR}/${f}`, "utf8")]));

describe("storage.objects policies are TO authenticated (Q572)", () => {
  it("the replay finds the real policy set", () => {
    // Prod held 35 storage.objects policies on 2026-10-02.
    expect(policies.size).toBeGreaterThan(25);
    expect(policies.has("Job participants can view proof photos")).toBe(true);
  });

  it("the parser reads a missing TO clause as public, and ALTER ... TO and DROP as later state", () => {
    const p = storageObjectPolicies([
      ["a.sql", `CREATE POLICY "x" ON storage.objects FOR SELECT USING (true);\nCREATE POLICY y ON storage.objects FOR SELECT TO anon, authenticated USING (true);`],
      ["b.sql", `ALTER POLICY "x" ON storage.objects TO authenticated;\nDROP POLICY IF EXISTS y ON storage.objects;\nCREATE POLICY "z" ON storage.objects FOR INSERT WITH CHECK (true);`],
    ]);
    expect([...p.entries()].map(([n, v]) => [n, v.roles])).toEqual([["x", ["authenticated"]], ["z", ["public"]]]);
  });

  it("no policy's newest definition names public or anon", () => {
    const offenders = [...policies.entries()]
      .filter(([, v]) => v.roles.some((r) => r === "public" || r === "anon"))
      .map(([n, v]) => `${n} (${v.roles.join(",")}; last set in ${v.file})`);
    expect(offenders).toEqual([]);
  });
});
