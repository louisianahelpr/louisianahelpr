/**
 * CLASS GUARD (Q54, front/back parity): every closed value set the CLIENT
 * writes or displays agrees with the DB CHECK that admits it.
 *
 * WHY. `pricing_mode` and `payment_status` are plain text columns; TypeScript
 * accepts any string, and the CHECK is the only thing that knows. A client
 * value the CHECK does not admit is an insert refused with 23514 (the
 * `application` report type shipped that way, 20260924182505); a CHECK value
 * the client's display union does not name is a row the screen cannot render.
 * The inventory is docs/audit/parity-matrix-2026-09-26.md, family "Enums and
 * ranges".
 *
 * HOW. The client side is read from its source (comments blanked, via
 * ./helpers/parityReaders); the server side is the newest CHECK on that
 * table/column, replayed from every migration by ./helpers/schemaConstraints.
 * Relation per row: WRITE sets must be a SUBSET of the CHECK; DISPLAY unions
 * that claim to describe the column must EQUAL it; numeric scales must lie
 * inside (or, for the 1..5 star scale, equal) the CHECK range.
 *
 * @mutate src/components/messages/useMessageReactions.ts | "‼️", "❓"] as const; | "‼️", "❓", "🔥"] as const;
 * @mutate supabase/migrations/20260811120000_message_pins_reactions_replies.sql | CHECK (emoji IN ('❤️', '👍', '👎', '😂', '‼️', '❓')) | CHECK (emoji IN ('❤️', '👍', '👎', '😂', '‼️'))
 * @mutate src/components/ReportDialog.tsx | type ReportedType = "job" \| "message" \| "user" \| "review" \| "application"; | type ReportedType = "job" \| "message" \| "user" \| "review" \| "application" \| "profile";
 * @mutate supabase/migrations/20260924182505_report_against_application.sql | 'review'::text, 'application'::text])); | 'review'::text]));
 * @mutate src/components/admin/AdminReports.tsx | type ReportFilter = "pending" \| "investigating" | type ReportFilter = "pending" \| "triage"
 * @mutate src/components/DisputeTimelineDialog.tsx | status: "open" \| "decided" \| "withdrawn" \| "superseded"; | status: "open" \| "decided" \| "withdrawn";
 * @mutate supabase/migrations/20260915071502_reapply_dispute_settlement_objects.sql | 'withdrawn'::text, 'superseded'::text])); | 'withdrawn'::text, 'superseded'::text, 'escalated'::text]));
 * @mutate src/lib/nps.ts | export type NpsRole = "customer" \| "helper"; | export type NpsRole = "poster" \| "helper";
 * @mutate src/components/feedback/NpsPrompt.tsx | {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => { | {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => {
 * @mutate src/lib/errorLogger.ts | type Severity = "info" \| "warning" \| "error" \| "fatal"; | type Severity = "info" \| "warning" \| "error" \| "fatal" \| "debug";
 * @mutate src/components/reviewPanel/StarRow.tsx | {[1, 2, 3, 4, 5].map((s) => ( | {[1, 2, 3, 4, 5, 6].map((s) => (
 * @mutate src/components/CompletionPrompts.tsx | {[1, 2, 3, 4, 5].map((s) => ( | {[1, 2, 3, 4].map((s) => (
 * @mutate supabase/migrations/20260311000404_f8e7eb29-742a-409a-a3a3-a493232415e6.sql | rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5), | rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
 * @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts | { value: 3, label: "Licensed + Insured" | { value: 4, label: "Licensed + Insured"
 * @mutate src/lib/nativePush.ts | async function persistPushToken(userId: string, token: string, platform: "ios" \| "android") | async function persistPushToken(userId: string, token: string, platform: "ios" \| "android" \| "macos")
 */
import { describe, it, expect } from "vitest";
import { extractConstraints, type Constraint } from "./helpers/schemaConstraints";
import { propertyUnion, readCode, stringArrayConst, stringUnion } from "./helpers/parityReaders";
import { CREDENTIAL_TIERS } from "@/components/postjob/detailsSection/detailsSectionConstants";

const constraints = extractConstraints();

/** The one parsed CHECK on table.column (throws if none, or if two disagree). */
function dbCheck(table: string, column: string): Constraint {
  const hits = [...(constraints.get(table)?.values() ?? [])].filter((c) => c.column === column);
  if (!hits.length) throw new Error(`no parsed CHECK on ${table}.${column}`);
  return hits[hits.length - 1];
}
function dbEnum(table: string, column: string): string[] {
  const c = dbCheck(table, column);
  if (c.kind !== "enum") throw new Error(`${table}.${column} CHECK is not a value list`);
  return c.values;
}
function dbRange(table: string, column: string): { min: number; max: number } {
  const c = dbCheck(table, column);
  if (c.kind !== "range" || c.min === null || c.max === null) throw new Error(`${table}.${column} CHECK is not a closed range`);
  return {
    min: c.exclusiveMin ? c.min + 1 : c.min,
    max: c.exclusiveMax ? c.max - 1 : c.max,
  };
}
/** `[1, 2, 3, 4, 5].map(` star-row literal in a component. */
function starScale(rel: string): number[] {
  const m = /\{\[([\d,\s]+)\]\.map\(/.exec(readCode(rel));
  if (!m) throw new Error(`${rel}: no star-row literal`);
  return m[1].split(",").map((s) => Number(s.trim()));
}
const sorted = (xs: readonly (string | number)[]) => [...xs].map(String).sort();

type Row = { id: string; relation: "subset" | "equal"; client: () => (string | number)[]; server: () => (string | number)[] };

const range = (r: { min: number; max: number }) => Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);

const ROWS: Row[] = [
  {
    id: "message reactions (TAPBACKS vs message_reactions_emoji_allowed)",
    relation: "equal",
    client: () => stringArrayConst("src/components/messages/useMessageReactions.ts", "TAPBACKS"),
    server: () => dbEnum("message_reactions", "emoji"),
  },
  {
    id: "report target types (ReportDialog ReportedType vs reports_reported_type_check)",
    relation: "subset",
    client: () => stringUnion("src/components/ReportDialog.tsx", "ReportedType"),
    server: () => dbEnum("reports", "reported_type"),
  },
  {
    id: "admin report status filters (AdminReports vs reports_status_check)",
    relation: "subset",
    client: () => {
      const code = readCode("src/components/admin/AdminReports.tsx");
      const filters = stringUnion("src/components/admin/AdminReports.tsx", "ReportFilter").filter((f) => f !== "all");
      const inList = /query\.in\("status",\s*\[([^\]]*)\]\)/.exec(code);
      if (!inList) throw new Error("AdminReports: pending filter no longer reads a status list");
      return [...filters, ...[...inList[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])];
    },
    server: () => dbEnum("reports", "status"),
  },
  {
    id: "dispute status display union (DisputeTimelineDialog vs disputes_status_check)",
    relation: "equal",
    client: () => propertyUnion("src/components/DisputeTimelineDialog.tsx", "status"),
    server: () => dbEnum("disputes", "status"),
  },
  {
    id: "NPS role (NpsRole vs nps_responses_user_role_check)",
    relation: "equal",
    client: () => stringUnion("src/lib/nps.ts", "NpsRole"),
    server: () => dbEnum("nps_responses", "user_role"),
  },
  {
    id: "NPS scale (NpsPrompt buttons vs nps_responses score CHECK)",
    relation: "subset",
    client: () => {
      const m = /Array\.from\(\{\s*length:\s*(\d+)\s*\},\s*\(_,\s*i\)\s*=>\s*i\s*\+\s*(\d+)\)/.exec(readCode("src/components/feedback/NpsPrompt.tsx"));
      if (!m) throw new Error("NpsPrompt: score buttons no longer generated from Array.from");
      return Array.from({ length: Number(m[1]) }, (_, i) => i + Number(m[2]));
    },
    server: () => range(dbRange("nps_responses", "score")),
  },
  {
    id: "error log severity (errorLogger Severity vs error_logs_severity_check)",
    relation: "equal",
    client: () => stringUnion("src/lib/errorLogger.ts", "Severity"),
    server: () => dbEnum("error_logs", "severity"),
  },
  {
    id: "review stars, ReviewForm/StarRow (vs reviews rating CHECK)",
    relation: "equal",
    client: () => starScale("src/components/reviewPanel/StarRow.tsx"),
    server: () => range(dbRange("reviews", "rating")),
  },
  {
    id: "review stars, CompletionPrompts (vs reviews rating CHECK)",
    relation: "equal",
    client: () => starScale("src/components/CompletionPrompts.tsx"),
    server: () => range(dbRange("reviews", "rating")),
  },
  {
    id: "credential tier picker (CREDENTIAL_TIERS vs jobs_credential_tier_check)",
    relation: "subset",
    client: () => CREDENTIAL_TIERS.map((t) => t.value),
    server: () => range(dbRange("jobs", "credential_tier")),
  },
  {
    id: "push token platform (nativePush persistPushToken vs push_tokens_platform_check)",
    relation: "subset",
    client: () => {
      const m = /function\s+persistPushToken\([^)]*platform:\s*("[^"]*"(?:\s*\|\s*"[^"]*")*)\s*\)/.exec(readCode("src/lib/nativePush.ts"));
      if (!m) throw new Error("nativePush: persistPushToken signature not found");
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    },
    server: () => dbEnum("push_tokens", "platform"),
  },
];

describe("closed value sets agree between client and DB CHECK (Q54)", () => {
  it("inventory floor: every row resolves on both sides", () => {
    expect(ROWS.length).toBeGreaterThan(10);
    for (const r of ROWS) {
      expect(r.client().length, `${r.id}: client side empty`).toBeGreaterThan(0);
      expect(r.server().length, `${r.id}: server side empty`).toBeGreaterThan(0);
    }
  });

  it.each(ROWS.map((r) => [r.id, r] as const))("%s", (_id, r) => {
    const client = sorted(r.client());
    const server = sorted(r.server());
    if (r.relation === "equal") {
      expect(client, `${r.id}: the two sides name different values`).toEqual(server);
    } else {
      const refused = client.filter((v) => !server.includes(v));
      expect(refused, `${r.id}: the client uses values the CHECK refuses`).toEqual([]);
    }
  });
});
