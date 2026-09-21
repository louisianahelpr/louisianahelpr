// The seeded group job (scripts/audit/prod-seed.mjs) must describe a row the
// database would actually accept — same reasoning, and the same reader, as
// fixtureSchemaContract.test.ts.
//
// WHY THIS IS ITS OWN FILE
// ------------------------
// fixtureSchemaContract.test.ts walks `e2e/` and `src/test/` for fixture
// literals. `scripts/audit/prod-seed.mjs` is neither — it's a standalone
// `.mjs` CLI script, outside that guard's walk and outside the `tsc -b`
// composite project — so the group job this script inserts (docs/OPEN.md,
// 2026-09-14: "prod has 0 group jobs, so group-job screens ... have no prod
// coverage") had no schema coverage at all before this file. It reads the
// literal payload TEXT out of the script — never imports the `.mjs` into the
// `src` composite project, for the same reason fixtureSchemaContract reads
// `seedData.ts` as text rather than importing it — and grades it with the
// exact same constraint reader.
//
// GROUP_JOB_ROW in the script deliberately holds only the CHECK-constrained,
// static fields (title, category, budget, status, is_group_job,
// helpers_needed) — id/customer_id/helper_id are filled in at apply time from
// runtime ids and are not CHECK-constrained, so their absence here does not
// weaken the grade.
//
// Re-proven able to fail 2026-09-20 (the note that it had been shown red once
// was verified, not trusted): `budget: 300` → `budget: 9000` in GROUP_JOB_ROW
// turns "finds no CHECK constraint the group job row would violate" red with
// `jobs.budget = 9000 — jobs_budget_range requires <= 5000`.
//
// @mutate scripts/audit/prod-seed.mjs |   budget: 300,\n  status: "open", |   budget: 9000,\n  status: "open",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  extractConstraints,
  schemaTables,
  schemaRequired,
  checkRow,
  literalReader,
  balanced,
} from "./helpers/schemaConstraints";

const REPO = resolve(__dirname, "../..");
const SCRIPT_REL = "scripts/audit/prod-seed.mjs";
const src = readFileSync(join(REPO, SCRIPT_REL), "utf8");

/** `const NAME = { … };` as source text — the script's own `jobBase` and
 *  `GROUP_JOB_ROW` are both this shape. */
function constObject(name: string): string {
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=\\n]*=\\s*`).exec(src);
  if (!decl) throw new Error(`${SCRIPT_REL}: no "const ${name} = {" found — did it get renamed?`);
  const start = decl.index + decl[0].length;
  if (src[start] !== "{") throw new Error(`${SCRIPT_REL}: "const ${name} =" is not an object literal`);
  const inner = balanced(src, start, "{", "}");
  if (inner === null) throw new Error(`${SCRIPT_REL}: unbalanced braces reading ${name}`);
  return `{${inner}}`;
}

/** The `groupJobHelperRows` function body, as source text — so the two
 *  roster-row literals inside its `return [ … ]` can be read the same way. */
function groupJobHelperRowsSource(): string {
  const decl = /function\s+groupJobHelperRows\s*\([^)]*\)\s*\{/.exec(src);
  if (!decl) throw new Error(`${SCRIPT_REL}: no "function groupJobHelperRows(" found — did it get renamed?`);
  const body = balanced(src, decl.index + decl[0].length - 1, "{", "}");
  if (body === null) throw new Error(`${SCRIPT_REL}: unbalanced braces reading groupJobHelperRows`);
  return body;
}

const constraints = extractConstraints();
const schema = schemaTables();
const required = schemaRequired();

describe("prod-seed.mjs group job fixture — could this row be inserted", () => {
  const groupJobRow = constObject("GROUP_JOB_ROW");
  const jobBaseRow = constObject("jobBase");
  // Same trick fixtureSchemaContract.test.ts uses for JOB_BASE: concatenate the
  // spread base's own literal text alongside the row's, so a value defined only
  // in the base (payment_status, pricing_mode) is still visible to the reader.
  const fullJobText = `${groupJobRow}\n${jobBaseRow}`;

  it("read both literals out of the script", () => {
    expect(groupJobRow).toContain("is_group_job");
    expect(groupJobRow).toContain("helpers_needed");
    expect(jobBaseRow).toContain("payment_status");
    expect(jobBaseRow).toContain("pricing_mode");
  });

  it("finds no CHECK constraint the group job row would violate", () => {
    const jobsConstraints = constraints.get("jobs");
    expect(jobsConstraints, "no CHECK constraints recovered for jobs — extractConstraints() may be broken").toBeTruthy();
    const violations = checkRow("jobs", literalReader(fullJobText), jobsConstraints!, `${SCRIPT_REL} GROUP_JOB_ROW`);
    expect(violations.map((v) => v.message)).toEqual([]);
  });

  it("uses only real jobs columns", () => {
    const cols = schema.get("jobs");
    expect(cols, "no columns recovered for jobs from types.ts").toBeTruthy();
    const clean = fullJobText.replace(/^\s*\/\/[^\n]*$/gm, "");
    const keys = new Set([...clean.matchAll(/(?:^\s*|[{,]\s*)([a-z0-9_]+):/gm)].map((k) => k[1]));
    const unknown = [...keys].filter((k) => !cols!.has(k));
    expect(unknown, "GROUP_JOB_ROW / jobBase name a column jobs does not have").toEqual([]);
  });

  it("sanity: the reader really rejects a row that IS impossible", () => {
    // Same value that has already broken this exact table twice (see
    // fixtureSchemaContract.test.ts's own header) — proof this file's grading
    // path is falsifiable, not vacuously green.
    const bad = checkRow(
      "jobs",
      literalReader(`{ payment_status: "paid", pricing_mode: "fixed", budget: 300 }`),
      constraints.get("jobs")!,
      "probe",
    );
    expect(bad.map((v) => v.message).join(" | ")).toMatch(/payment_status/);
    expect(bad.map((v) => v.message).join(" | ")).toMatch(/pricing_mode/);
  });
});

describe("prod-seed.mjs group job fixture — the roster rows could be inserted", () => {
  const fnBody = groupJobHelperRowsSource();
  // Two `{ … }` rows inside the `return [ … ]` array.
  const rows: string[] = [];
  for (let i = 0; i < fnBody.length; i++) {
    if (fnBody[i] !== "{") continue;
    const inner = balanced(fnBody, i, "{", "}");
    if (inner === null) break;
    rows.push(`{${inner}}`);
    i += inner.length + 1;
  }

  it("found both roster rows", () => {
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).toContain("status");
  });

  it("uses only real group_job_helpers columns and names no NOT-NULL column with no default", () => {
    const cols = schema.get("group_job_helpers");
    const req = required.get("group_job_helpers");
    expect(cols, "no columns recovered for group_job_helpers from types.ts").toBeTruthy();
    for (const row of rows) {
      const clean = row.replace(/^\s*\/\/[^\n]*$/gm, "");
      const keys = new Set([...clean.matchAll(/(?:^\s*|[{,]\s*)([a-z0-9_]+):/gm)].map((k) => k[1]));
      const unknown = [...keys].filter((k) => !cols!.has(k));
      expect(unknown, `roster row names a column group_job_helpers does not have: ${row}`).toEqual([]);
      // Every key in the function's parameter list (jobId, helperId,
      // applicantId) is supplied by name at every call site — only the
      // literal `status: "accepted"` needs grading here, but a required
      // column missing BY NAME would still be a real bug, so check it too.
      const missing = [...(req ?? [])].filter((r) => !keys.has(r));
      expect(missing, `roster row is missing a required column: ${row}`).toEqual([]);
    }
  });

  it("finds no CHECK constraint the roster rows would violate", () => {
    const forTable = constraints.get("group_job_helpers") ?? new Map();
    const violations = rows.flatMap((row, i) =>
      checkRow("group_job_helpers", literalReader(row), forTable, `${SCRIPT_REL} groupJobHelperRows[${i}]`),
    );
    expect(violations.map((v) => v.message)).toEqual([]);
  });
});
