/**
 * The server and the app agree on what a lease needs (lead review of the lease #3 #9). rentals_lease_send
 * refuses a lease with a required blank empty (rentals_lease_missing) or an initialed clause not ticked
 * (rentals_lease_initial_keys); the app's form (LEASE_FIELDS) and sign sheet (LEASE_INITIALED) must ask
 * for exactly the same, or a landlord could fill every box the app shows and still be refused, or the
 * server could pass a blank the app never asked for. Read from the NEWEST definition, both ways.
 *
 * @mutate supabase/migrations/20261019110137_rentals_lease.sql |         ('mold_details', false, 'flood_disclosure', 'true', 'mold', 'Yes') |         ('mold_details', false, 'flood_disclosure', 'true', NULL, NULL)
 * @mutate supabase/migrations/20261019110137_rentals_lease.sql |         ('rent_amount', false, NULL, NULL, NULL, NULL), |         ('rent_amount_x', false, NULL, NULL, NULL, NULL),
 * @mutate src/lib/rentals/leaseTemplate.ts |   { key: "notice_waiver", label: "Section 19: the tenant waives the five-day notice to vacate." }, |   { key: "notice_waivers", label: "x" },
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { LEASE_FIELDS, LEASE_INITIALED, LEASE_TEMPLATE_VERSION, initialLeaseFields, isFieldShown, type LeaseFields } from "@/lib/rentals/leaseTemplate";

const DIR = join(process.cwd(), "supabase/migrations");

/** The newest CREATE FUNCTION public.<name>( body, any dollar tag. */
function newestBody(name: string): string {
  let found = "";
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(DIR, f), "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      if (!t) continue;
      found = sql.slice(t.index + t[0].length, sql.indexOf(t[1], t.index + t[0].length));
    }
  }
  return found;
}

type Row = { key: string; isYes: boolean; c1?: [string, string]; c2?: [string, string] };

function sqlRows(): Row[] {
  const body = newestBody("rentals_lease_missing");
  const start = body.indexOf(`-- ${LEASE_TEMPLATE_VERSION} REQUIRED BEGIN`);
  const end = body.indexOf(`-- ${LEASE_TEMPLATE_VERSION} REQUIRED END`);
  expect(start).toBeGreaterThan(0);
  const block = blankSqlComments(body.slice(start, end));
  const rows: Row[] = [];
  for (const m of block.matchAll(/\('([a-z0-9_]+)',\s*(true|false),\s*(NULL|'[^']*'),\s*(NULL|'[^']*'),\s*(NULL|'[^']*'),\s*(NULL|'[^']*')\)/g)) {
    const v = (x: string) => (x === "NULL" ? null : x.slice(1, -1));
    const c1k = v(m[3]), c1v = v(m[4]), c2k = v(m[5]), c2v = v(m[6]);
    rows.push({ key: m[1], isYes: m[2] === "true", c1: c1k ? [c1k, c1v ?? ""] : undefined, c2: c2k ? [c2k, c2v ?? ""] : undefined });
  }
  return rows;
}

const asValue = (v: string): string | boolean => (v === "true" ? true : v === "false" ? false : v);

describe("lease: the server's required blanks are the app's (both ways)", () => {
  const rows = sqlRows();
  const byKey = new Map(rows.map((r) => [r.key, r]));

  it("reads the server list (floor)", () => {
    expect(rows.length).toBeGreaterThan(80);
  });

  it("every required field the app asks for is required by the server, and nothing else", () => {
    const app = LEASE_FIELDS.filter((f) => !f.optional).map((f) => f.key).sort();
    expect(rows.map((r) => r.key).sort()).toEqual(app);
  });

  it("a yes/no is a yes/no on both sides", () => {
    for (const f of LEASE_FIELDS) expect(byKey.get(f.key)?.isYes, f.key).toBe(f.kind === "yes");
  });

  it("each blank is asked under exactly the server's conditions", () => {
    for (const f of LEASE_FIELDS) {
      const r = byKey.get(f.key)!;
      const conds = [r.c1, r.c2].filter((c): c is [string, string] => !!c);
      expect(!!f.showIf, `${f.key}: conditional on one side only`).toBe(conds.length > 0);
      if (conds.length === 0) continue;
      const met: LeaseFields = { ...initialLeaseFields() };
      for (const [k, v] of conds) met[k] = asValue(v);
      expect(isFieldShown(f, met), `${f.key}: shown when the server asks`).toBe(true);
      for (const [k] of conds) {
        const unmet: LeaseFields = { ...met, [k]: k === conds[0][0] && typeof met[k] === "boolean" ? !met[k] : "__other__" };
        expect(isFieldShown(f, unmet), `${f.key}: hidden when ${k} differs`).toBe(false);
      }
    }
  });

  it("the clauses to initial are the server's (sorted, same keys)", () => {
    const body = newestBody("rentals_lease_initial_keys");
    const keys = [...(/ARRAY\[([^\]]+)\]/.exec(body)?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(2);
    // The app keeps the lease's own order; the server's list is sorted: compared as sets.
    expect(LEASE_INITIALED.map((c) => c.key).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(LEASE_FIELDS.find((f) => f.key === k)?.kind, k).toBe("yes");
  });
});
