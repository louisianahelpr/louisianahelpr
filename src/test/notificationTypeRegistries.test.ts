import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rows } from "@/components/notificationPreferences/constants";
import { typeIcons } from "@/components/notificationPanel/notificationPanelHelpers";

/**
 * SIX registries describe the same closed set of notification types, and
 * nothing made them agree.
 *
 *   1. `notifications_type_check`            — the DB CHECK Postgres enforces
 *   2. `notification_type_pref_map`          — which push preference gates it
 *   3. `ALLOWED_TYPES`                       — create-notification's allowlist
 *   4. `TYPE_MAP`                            — send-notification-email's gate
 *   5. `typeIcons`                           — the notification centre's glyph
 *   6. `rows`                                — the switches on the prefs screen
 *
 * Every drift between them has been a real, shipped defect:
 *
 *   * (1) without (2) is the FAIL-OPEN. `warning`, `info` and `success` were in
 *     the CHECK and absent from the map, so `fan_out_push_on_notification`
 *     found a NULL pref column and pushed with no category check at all —
 *     791 of 1802 notifications, 43.9%, measured 2026-09-02 (N-004).
 *   * (2) without (6) is the INVISIBLE PREFERENCE. The map routed through ten
 *     columns; the prefs screen rendered seven switches. `job_applications`,
 *     `job_updates`, `payments` and `system_alerts` were enforced against a
 *     value the user could not see or change (N-005).
 *   * (2) disagreeing with (4) is the HALF-OBEYED SWITCH. Push gated
 *     `application` on `job_applications` while email gated it on
 *     `email_new_offers`, so one channel honoured the switch and the other
 *     did not (N-011).
 *
 * The rule this file exists to enforce is the one that keeps being relearned:
 * A LIST THAT IS BOTH THE INPUT AND THE DEFINITION OF CORRECTNESS CANNOT FAIL
 * FOR A MISSING MEMBER. So nothing here is hand-written. The type set is
 * PARSED out of the CHECK constraint in `supabase/migrations/` — the one
 * registry Postgres actually enforces, which no code path can go outside —
 * and every other registry is diffed against it.
 *
 * Filesystem only: no database, no network. It runs in CI on every push.
 */

const repoRoot = resolve(__dirname, "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  // Filename prefix IS the apply order, so a lexical sort is the replay order.
  .sort();

/**
 * Split SQL into statements, tracking single-quoted strings so a `;` or a `--`
 * INSIDE a literal does not end one.
 *
 * Not pedantry: the map's own seed descriptions contain both. A naive
 * `[\s\S]*?;` stopped mid-VALUES at the semicolon in "Severity label (legacy)
 * — spans several categories; matches send-notification-email TYPE_MAP." and
 * parsed one of the three rows, which made this test pass a set it had only
 * partly read. A parser that silently reads less than it claims is worse than
 * no parser, so it is worth the thirty lines.
 */
function sqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      // Copy the literal verbatim, including '' escapes.
      cur += c;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { cur += "''"; i += 2; continue; }
        if (sql[i] === "'") { cur += "'"; i++; break; }
        cur += sql[i];
        i++;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "$" && sql.startsWith("$$", i)) {
      // Dollar-quoted function bodies hold whole statements; skip them whole.
      const end = sql.indexOf("$$", i + 2);
      if (end === -1) break;
      cur += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (c === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// (1) The enforced set: the LAST `notifications_type_check` in replay order.
// ---------------------------------------------------------------------------
function enforcedTypes(): Set<string> {
  let latest: string | null = null;
  for (const file of migrationFiles) {
    for (const stmt of sqlStatements(readFileSync(resolve(migrationsDir, file), "utf8"))) {
      const m = stmt.match(
        /ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
      );
      if (m) latest = m[1];
    }
  }
  if (latest === null) {
    throw new Error(
      "No `ADD CONSTRAINT notifications_type_check` found in supabase/migrations — " +
        "the constraint was renamed or dropped, and this whole test is now blind. Fix the parser, do not delete the test.",
    );
  }
  return new Set([...latest.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

// ---------------------------------------------------------------------------
// (2) The push gate: every `notification_type_pref_map` seed row, last wins.
// ---------------------------------------------------------------------------
function prefMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of migrationFiles) {
    for (const stmt of sqlStatements(readFileSync(resolve(migrationsDir, file), "utf8"))) {
      // Only INSERT statements. The table is also read by
      // fan_out_push_on_notification, and that SELECT is not a seed row.
      const m = stmt.match(
        /INSERT\s+INTO\s+public\.notification_type_pref_map\s*\([^)]*\)\s*VALUES([\s\S]*)/i,
      );
      if (!m) continue;
      // Match only the first two quoted identifiers of each tuple — the third
      // column is free prose that may contain escaped quotes.
      for (const t of m[1].matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,/g)) {
        map.set(t[1], t[2]);
      }
    }
  }
  if (!map.has("message")) {
    throw new Error("notification_type_pref_map seed rows did not parse — the statement splitter or the tuple regex is broken, and every assertion below would pass vacuously.");
  }
  return map;
}

// ---------------------------------------------------------------------------
// (3)/(4) The two edge-function registries, read as source text. They are Deno
// modules with `npm:` specifiers, so vitest cannot import them.
// ---------------------------------------------------------------------------
function allowedTypes(): Set<string> {
  const src = readFileSync(
    resolve(repoRoot, "supabase/functions/create-notification/index.ts"),
    "utf8",
  );
  const m = src.match(/const\s+ALLOWED_TYPES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("ALLOWED_TYPES not found in create-notification/index.ts");
  return new Set([...m[1].replace(/\/\/[^\n]*/g, "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

function emailTypeMap(): Map<string, string> {
  const src = readFileSync(
    resolve(repoRoot, "supabase/functions/send-notification-email/index.ts"),
    "utf8",
  );
  const m = src.match(/const\s+TYPE_MAP:[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error("TYPE_MAP not found in send-notification-email/index.ts");
  const out = new Map<string, string>();
  for (const e of m[1].replace(/\/\/[^\n]*/g, "").matchAll(/(\w+):\s*\{\s*prefCol:\s*'(\w+)'/g)) {
    out.set(e[1], e[2]);
  }
  return out;
}

const TYPES = enforcedTypes();
const PREF_MAP = prefMap();
const ALLOWED = allowedTypes();
const EMAIL_MAP = emailTypeMap();

describe("notification type registries", () => {
  it("parses a plausible enforced type set (guards the parsers themselves)", () => {
    // A regex that silently matched nothing would make every assertion below
    // vacuously pass — the exact failure mode this file exists to prevent.
    expect(TYPES.size).toBeGreaterThanOrEqual(17);
    expect(TYPES).toContain("message");
    expect(PREF_MAP.size).toBeGreaterThanOrEqual(17);
    expect(ALLOWED.size).toBeGreaterThanOrEqual(17);
    expect(EMAIL_MAP.size).toBeGreaterThanOrEqual(17);
    expect(Object.keys(typeIcons).length).toBeGreaterThanOrEqual(17);
  });

  it("every enforced type has a push preference column (no fail-open)", () => {
    // An unmapped type makes fan_out_push_on_notification RAISE a warning and
    // push WITHOUT checking the user's category switch. That is N-004.
    const unmapped = [...TYPES].filter((t) => !PREF_MAP.has(t)).sort();
    expect(unmapped).toEqual([]);
  });

  it("the pref map never routes a type the CHECK does not permit", () => {
    const orphaned = [...PREF_MAP.keys()].filter((t) => !TYPES.has(t)).sort();
    expect(orphaned).toEqual([]);
  });

  it("create-notification's allowlist matches the enforced set exactly", () => {
    // Narrower than the CHECK silently 400s a legitimate producer; wider lets
    // a caller launder copy through a type nothing renders.
    expect([...ALLOWED].sort()).toEqual([...TYPES].sort());
  });

  it("email gates every enforced type, on the same column push does", () => {
    // Coverage, then agreement. `promotion` is deliberately in TYPE_MAP and
    // not in the CHECK — marketing mail calls the function with its own type
    // string — so this asserts the CHECK set is covered, not equality.
    const missing = [...TYPES].filter((t) => !EMAIL_MAP.has(t)).sort();
    expect(missing).toEqual([]);

    const disagreements = [...TYPES]
      .filter((t) => EMAIL_MAP.get(t) !== `email_${PREF_MAP.get(t)}`)
      .map((t) => `${t}: push=${PREF_MAP.get(t)} email=${EMAIL_MAP.get(t)}`)
      .sort();
    expect(disagreements).toEqual([]);
  });

  it("the notification centre can draw every enforced type", () => {
    // A missing glyph renders an empty box beside real copy.
    const iconless = [...TYPES].filter((t) => !(t in typeIcons)).sort();
    expect(iconless).toEqual([]);
  });

  it("every gating preference column has a switch on the prefs screen", () => {
    // THE N-005 GUARD. Derived from the map, not from a list of four: if a
    // later migration routes a type through a new column, this fails until
    // that column gets a control. `push_enabled` is excluded because it is the
    // master switch, which the screen renders separately.
    const gatingColumns = new Set(PREF_MAP.values());
    gatingColumns.delete("push_enabled");
    const switched = new Set<string>(rows.map((r) => r.key));
    const unswitched = [...gatingColumns].filter((c) => !switched.has(c)).sort();
    expect(unswitched).toEqual([]);
  });

  it("every switch has an email twin named for its push column", () => {
    // `emailKey` drives both the Email column and the email master switch;
    // a mismatched pair silently detaches one channel from its own label.
    const mismatched = rows
      .filter((r) => r.emailKey !== `email_${r.key}`)
      .map((r) => `${r.key} -> ${r.emailKey}`);
    expect(mismatched).toEqual([]);
  });
});
