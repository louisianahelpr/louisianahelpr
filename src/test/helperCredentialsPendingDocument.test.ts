// Q102/Q115 (docs/OPEN.md): a trade_license/insurance helper_credentials row
// in unverified/submitted with no document is a state prod refuses
// (`helper_credentials_pending_review_needs_document`, migration
// 20260923101130). Two test-side files described that impossible state
// anyway — e2e/happy-path/seedData.ts seeded credential
// 68000000-…-0003 (trade_license, 'submitted') with no `document_url`, and
// its mocked `get_pending_credentials()` returned `license_url: null` for
// every row regardless of the row's real document — until Q115 fixed both.
//
// WHY THIS EXISTS
// ----------------
// `fixtureSchemaContract.test.ts` deliberately SKIPS
// `helper_credentials_pending_review_needs_document`: it is a multi-column,
// conditional CHECK (credential_type AND status together gate document_url),
// and that guard only reads single-column, unconditional constraints (see
// schemaConstraints.ts's "DELIBERATELY DOES NOT"). So nothing caught the
// Q102-impossible row until an admin lane read it by hand. This closes that
// gap directly, by reading every helper_credentials-shaped object literal
// under e2e/ and scripts/ and checking it against the constraint's own rule.
//
// WHAT COUNTS AS A HELPER_CREDENTIALS WRITE HERE
// -----------------------------------------------
// Any object literal carrying a `credential_type:` field. `status` is read
// from the literal when present; when absent, this treats the row as if it
// will end up 'submitted' — the conservative assumption, because
// `trg_credential_status_server_owned` (20260903012612) forces every
// member-authored INSERT to status 'submitted' regardless of what the client
// sends, so an insert with no explicit status still lands in the state the
// CHECK constrains.
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { objectLiterals } from "./helpers/schemaConstraints";

const REPO = resolve(__dirname, "../..");
const NEEDS_DOCUMENT_TYPES = new Set(["trade_license", "insurance", "bond"]); // bond: Q130 (helper_credentials_pending_bond_needs_document)
const PENDING_STATUSES = new Set(["unverified", "submitted"]);

/** `key: <raw value up to the next top-level comma or closing brace>`, or null if absent. */
function rawField(text: string, key: string): string | null {
  const clean = text.replace(/^\s*\/\/[^\n]*$/gm, "");
  const m = new RegExp(`(?:^\\s*|[{,]\\s*)${key}:\\s*`, "m").exec(clean);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Value may itself be a template literal, string, identifier or `null` —
  // none of those shapes contain an unescaped top-level `,` or `}` before
  // their own end, so scanning for the first one at depth 0 is enough.
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (quote) {
      if (c === quote && clean[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return clean.slice(start, i).trim();
      depth--;
    } else if (c === "," && depth === 0) {
      return clean.slice(start, i).trim();
    }
  }
  return null;
}

function stringLiteral(raw: string | null): string | null {
  if (raw === null) return null;
  const m = /^(['"])((?:(?!\1).)*)\1$/.exec(raw);
  return m ? m[2] : null;
}

type Row = { file: string; literal: string; credentialType: string; status: string; documentRaw: string | null };

function findCredentialRows(roots: string[]): Row[] {
  const files = walkSource(roots, [".ts", ".mjs"]);
  const out: Row[] = [];
  for (const file of files) {
    const src = readSource(file);
    if (src === null) continue;
    const rel = file.replace(`${REPO}/`, "");
    // Cheap pre-filter before the expensive balanced-brace walk.
    if (!src.includes("credential_type")) continue;
    for (const lit of objectLiterals(src)) {
      if (!/credential_type\s*:/.test(lit)) continue;
      const credentialType = stringLiteral(rawField(lit, "credential_type"));
      if (!credentialType) continue;
      const statusRaw = stringLiteral(rawField(lit, "status"));
      out.push({
        file: rel,
        literal: lit,
        credentialType,
        status: statusRaw ?? "submitted", // trigger-forced default on INSERT
        documentRaw: rawField(lit, "document_url"),
      });
    }
  }
  return out;
}

const ROOTS = [join(REPO, "e2e"), join(REPO, "scripts")];
const rows = findCredentialRows(ROOTS);
const pending = rows.filter((r) => NEEDS_DOCUMENT_TYPES.has(r.credentialType) && PENDING_STATUSES.has(r.status));

function violation(r: Row): string | null {
  if (r.documentRaw === null) return `${r.file}: ${r.credentialType} row (status ${r.status}) omits document_url`;
  if (r.documentRaw === "null") return `${r.file}: ${r.credentialType} row (status ${r.status}) sets document_url: null`;
  if (stringLiteral(r.documentRaw) === "") return `${r.file}: ${r.credentialType} row (status ${r.status}) sets document_url to an empty string`;
  return null;
}

describe("the credential-row reader really finds helper_credentials writes", () => {
  it("recovers a non-trivial number of them, on the files that matter", () => {
    // Measured 2026-09-23: seedData.ts (2 trade_license + 1 insurance
    // literal), the mocked get_pending_credentials() RPC (which reads
    // credential_type but does not write a row), harness.ts's messy-input
    // insert, and prod-seed.mjs's 3 seeded credentials. A collapse below this
    // floor means the walker or the literal reader broke, not that every
    // caller stopped writing helper_credentials rows.
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("finds the ones that must carry a document", () => {
    // seedData.ts 68000000-…-0003 (trade_license, submitted), the harness.ts
    // messy-input insert (trade_license, no explicit status → assumed
    // submitted), and prod-seed.mjs's seeded license (trade_license,
    // submitted). A collapse here means the pending-status filter broke.
    expect(pending.length).toBeGreaterThanOrEqual(3);
  });

  it("actually flags a row the CHECK constraint would refuse", () => {
    const bad: Row = { file: "probe", literal: "", credentialType: "trade_license", status: "submitted", documentRaw: "null" };
    expect(violation(bad)).toMatch(/document_url: null/);
    const missing: Row = { file: "probe", literal: "", credentialType: "insurance", status: "unverified", documentRaw: null };
    expect(violation(missing)).toMatch(/omits document_url/);
    // …and accepts one it would accept, so the grader is not simply always red.
    const good: Row = { file: "probe", literal: "", credentialType: "trade_license", status: "submitted", documentRaw: '"https://x/y.pdf"' };
    expect(violation(good)).toBeNull();
    // A row outside the two gated types, or not awaiting review, never even
    // reaches `violation()` in real use — the `pending` filter below excludes
    // it first — so a document-less background_check or a verified/expired
    // trade_license is legitimately never flagged.
    const exemptType = { credentialType: "background_check", status: "submitted" };
    expect(NEEDS_DOCUMENT_TYPES.has(exemptType.credentialType) && PENDING_STATUSES.has(exemptType.status)).toBe(false);
    const exemptStatus = { credentialType: "trade_license", status: "verified" };
    expect(NEEDS_DOCUMENT_TYPES.has(exemptStatus.credentialType) && PENDING_STATUSES.has(exemptStatus.status)).toBe(false);
  });
});

// Proven able to fail on the exact original defect, 2026-09-23: with the
// document stripped back off seedData.ts's seeded trade_license row, this
// line turns red. Restoring the row (this file's current state) turns it
// green again.
// @mutate e2e/happy-path/seedData.ts | document_url: `${HELPER_ID}/credentials/trade_license-1757721600000.pdf`, | document_url: null,
describe("no e2e/ or scripts/ file writes a document-less pending trade_license/insurance row", () => {
  it("finds none of the walked rows in the impossible state", () => {
    const offenders = pending.map(violation).filter((v): v is string => v !== null);
    expect(offenders).toEqual([]);
  });
});
