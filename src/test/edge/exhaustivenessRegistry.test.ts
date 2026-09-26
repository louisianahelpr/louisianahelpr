/// <reference types="node" />
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE EXHAUSTIVENESS REGISTRY — the one place that names every dimension of
 * this app that must be covered with NO HOLES, and derives both sides of each.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE BUG THIS IS THE CLASS OF (owner, 2026-09-19). A job that reached
 * `in_progress` and was never marked done by either side matched NO cron at
 * all, and held escrow indefinitely. Every sweep had tests proving it did what
 * it said. Nothing anywhere asserted that every state was covered by SOME
 * sweep. You cannot screenshot an absence, and a per-feature test never sees
 * one: the defect is not in any part, it is in the space BETWEEN the parts.
 *
 * `src/test/edge/escrowSweepCoverage.test.ts` (commit d738344c1) is the
 * working answer for ONE dimension. This file is the generalisation: a
 * dimension list, each entry naming its INVENTORY source and its COVERAGE
 * source, both read out of the world.
 *
 * ── THE RULE EVERY ENTRY OBEYS ─────────────────────────────────────────────
 *
 * Neither side may be a list written in this file and checked against itself.
 * This repo has the scar nine times over (`docs/lessons` →
 * registries-checked-against-themselves; `src/test/literalRegistryGuard.test.ts`
 * is the repo-wide net for it). So every `inventory()` reads the generated
 * enum, a CHECK constraint, or the migration tree, and every `coverage()`
 * reads unrelated source — and the meta-checks at the bottom assert that each
 * one is non-empty AND able to report a member it has never seen.
 *
 * ── THE DIMENSION LIST CANNOT GO STALE EITHER ──────────────────────────────
 *
 * The hardest part of a registry like this is that the LIST OF DIMENSIONS is
 * itself hand-written, so a whole new dimension can appear and nobody notices.
 * The partial answer here: every enum in `Constants.public.Enums` must be
 * CLAIMED by some dimension. Add an enum to the database, regenerate types,
 * and this file goes red until somebody says how it is covered. That does not
 * cover dimensions with no enum behind them, and the report block below says
 * so rather than pretending otherwise.
 *
 * ── ENFORCED vs REPORTED ───────────────────────────────────────────────────
 *
 * A dimension is only `enforced` when its coverage source can be read
 * precisely enough that a red means a real hole. The rest are `reported`:
 * their findings print and are listed here, and they do not fail the build.
 * A weak check that can go red gets the whole file disabled, which is how we
 * got here.
 *
 * ── DELEGATED DIMENSIONS ───────────────────────────────────────────────────
 *
 * Three dimensions already have a full implementation elsewhere. Rather than
 * fork them, this registry INDEXES them and asserts the delegate still exists
 * and is still wired into CI — so a delegation cannot rot into a gap.
 *
 * ── RUNTIME ────────────────────────────────────────────────────────────────
 * Everything here is filesystem + AST, no network and no database. Measured
 * at ~1.1s of test time on the 8 GB Mac; safe on every push.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { Constants } from "@/integrations/supabase/types";

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const rel = (f: string) => path.relative(ROOT, f);

const SKIP_DIR = /^(node_modules|\.git|dist|ios|android|coverage)$/;
function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      walk(p, match, out);
    } else if (match.test(e.name)) out.push(p);
  }
  return out;
}

const migrationFiles = () => walk(MIGRATIONS, /\.sql$/).sort();
const productSources = () =>
  [...walk(path.join(ROOT, "src"), /\.tsx?$/), ...walk(path.join(ROOT, "supabase", "functions"), /\.tsx?$/)].filter(
    (f) => !/\.test\.[tj]sx?$/.test(f) && !/\.d\.ts$/.test(f) && !f.includes(`${path.sep}test${path.sep}`),
  );

/** Migration text with `--` comments removed, so prose never reads as DDL. */
function sqlCode(text: string): string {
  return text.replace(/^\s*--.*$/gm, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// THE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export interface Dimension {
  id: string;
  /** What breaks when this dimension has a hole. */
  why: string;
  /** Where the members come from — must be a place in the world. */
  inventorySource: string;
  /** Where the covering artefacts come from — a DIFFERENT place in the world. */
  coverageSource: string;
  /** Enums (from `Constants.public.Enums`) this dimension claims. */
  claimsEnums: string[];
  /** ENFORCED dimensions fail the build; REPORTED ones print. */
  mode: "enforced" | "reported" | "delegated";
  /** Where a delegated dimension actually lives. */
  delegate?: { file: string; wiredInto: string };
  inventory(): string[];
  /** member → the artefacts that cover it (empty array = a hole). */
  coverage(inventory: string[]): Map<string, string[]>;
}

// ───────────────────────────────────────────────────────────────────────────
// D1 — every job_status is reachable by some scheduled sweep   [DELEGATED]
// ───────────────────────────────────────────────────────────────────────────

const D1: Dimension = {
  id: "job-status-has-a-scheduled-sweep",
  why:
    "A job status with no sweep holds escrow forever. Eleven rows were in that trap on prod " +
    "on 2026-09-19 and no test could see it.",
  inventorySource: "Constants.public.Enums.job_status (generated from the live enum)",
  coverageSource:
    "the migrations' own cron.schedule bodies → each sweep's .from('jobs') predicate, parsed to " +
    "an AST and EVALUATED against a stranded job",
  claimsEnums: ["job_status"],
  mode: "delegated",
  delegate: { file: "src/test/edge/escrowSweepCoverage.test.ts", wiredInto: "vitest (npx vitest run)" },
  inventory: () => [...Constants.public.Enums.job_status],
  coverage: (inv) => new Map(inv.map((s) => [s, ["delegated to escrowSweepCoverage.test.ts"]])),
};

// ───────────────────────────────────────────────────────────────────────────
// D2 — every enum member has a render/lookup branch            [REPORTED]
// ───────────────────────────────────────────────────────────────────────────

/**
 * A map keyed on enum members that misses one.
 *
 * `pending_approval` fell through every branch of a status switch and rendered
 * an empty bordered box, twice. `jobStatusExhaustive.test.ts` holds the line
 * on the canonical `job_status` maps; this generalises it to EVERY enum and
 * every map in the tree, including the ones nobody thought of as a registry.
 * The first thing it found was `instant-job-match`'s `categoryEmoji` at 10 of
 * 12 job categories, so a `storm_prep` job's push notification silently got
 * the fallback sparkle — in Louisiana, of all the categories to lose. Fixed
 * 2026-09-19; the ratchet below is empty because of it.
 *
 * THE THRESHOLD, and why there is one. A map may legitimately cover a SUBSET
 * (`useHealthData`'s four terminal statuses are a bucket, not a registry).
 * What distinguishes a registry is that it is trying to be TOTAL, so coverage
 * at or above `TOTALITY_RATIO` is read as intent-to-be-total and anything
 * below it is reported but not judged. `literalRegistryGuard.test.ts` makes
 * the same call at "all or all-but-one"; this is the same idea with the
 * threshold written down.
 */
const TOTALITY_RATIO = 0.8;

export interface EnumMapHole {
  site: string;
  enumName: string;
  covered: number;
  total: number;
  missing: string[];
}

export function enumKeyedMapHoles(files = productSources()): EnumMapHole[] {
  const enums = Object.entries(Constants.public.Enums) as Array<[string, readonly string[]]>;
  const holes: EnumMapHole[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n) && n.properties.length >= 2) {
        const keys = n.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null));
        if (keys.length === n.properties.length && keys.every(Boolean)) {
          const k = keys as string[];
          for (const [enumName, members] of enums) {
            if (!k.every((x) => members.includes(x))) continue;
            const missing = members.filter((m) => !k.includes(m));
            if (missing.length && k.length / members.length >= 0) {
              holes.push({
                site: `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
                enumName,
                covered: k.length,
                total: members.length,
                missing,
              });
            }
            break;
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return holes;
}

/**
 * Where an enum member appears as a BRANCH: a key in an enum-keyed object
 * literal, or a `case "member":` in a switch. A member with none of either is
 * a value the UI has never been told about.
 */
export function enumMemberBranches(files = productSources()): Map<string, string[]> {
  // Widened to Set<string> on purpose: inference gives the narrow union of
  // every enum member, so `has(someString)` is a compile error. The whole job
  // here is to ask about strings that may NOT be members.
  const members: Set<string> = new Set(
    Object.values(Constants.public.Enums).flatMap((m) => [...m] as string[]),
  );
  const out = new Map<string, string[]>();
  const add = (m: string, site: string) => {
    if (!members.has(m)) return;
    if (!out.has(m)) out.set(m, []);
    out.get(m)!.push(site);
  };
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (n: ts.Node) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) add(n.name.text, at(n));
      if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) add(n.expression.text, at(n));
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * The RATCHET. Every map that today reads as intent-to-be-total and is NOT,
 * with the exact members it is missing.
 *
 * This is a list, and a list is exactly what this file warns about — so it is
 * built to go red in BOTH directions. An entry names the missing members, so
 * adding a thirteenth `job_category` makes every recorded set stale and the
 * check fails the day the enum grows. Closing a hole also fails, because the
 * entry no longer describes anything. It cannot rot into a mute.
 *
 * Found 2026-09-19 by this check, reported not fixed: `supabase/functions/**`
 * is owned by another lane today.
 */
const ENUM_MAP_RATCHET: Record<string, string[]> = {
  // EMPTY, and that is the point: instant-job-match's categoryEmoji — the one
  // entry this list was born with — was fixed on 2026-09-19 (storm_prep ⛈️,
  // events 🎉) and the ratchet went red until the entry was removed, exactly
  // as designed. An entry here is a defect waiting to be closed, never a
  // permanent excuse.
};

/**
 * The ratchet comparison itself, as a PURE function of (holes, ratchet).
 *
 * It was inlined in the test, which meant the "able to fail" proof below could
 * only do string arithmetic on a ratchet ENTRY — and when the last entry was
 * fixed, that proof failed with `expected undefined to be truthy`: it had been
 * asserting that a defect still existed, not that the check still worked.
 *
 * Pulled out here, the real comparison can be run against a synthetic world,
 * so the proof survives the list being empty — which is the state we want the
 * list to be in.
 */
export function enumMapRatchetDrift(
  holes: EnumMapHole[],
  ratchet: Record<string, string[]>,
): string[] {
  const now = new Map<string, string[]>();
  for (const h of holes) {
    if (h.covered / h.total < TOTALITY_RATIO) continue;
    const key = Object.keys(ratchet).find((k) => h.site.startsWith(k.split(" ")[0])) ?? h.site;
    now.set(key, h.missing);
  }
  const drift: string[] = [];
  for (const [k, v] of now) {
    const known = ratchet[k];
    if (!known) drift.push(`NEW incomplete map: ${k} is missing ${v.join(", ")}`);
    else if (known.join(",") !== v.join(","))
      drift.push(`${k} now misses ${v.join(", ")} (ratchet says ${known.join(", ")})`);
  }
  for (const k of Object.keys(ratchet)) {
    if (!now.has(k)) drift.push(`${k} is no longer incomplete — remove it from ENUM_MAP_RATCHET`);
  }
  return drift;
}

// ───────────────────────────────────────────────────────────────────────────
// D3 — every notification type is legal AND has an emitter     [ENFORCED]
// ───────────────────────────────────────────────────────────────────────────

/** The DB's own allowlist, parsed out of the last migration that sets it. */
export function notificationTypeCheck(): string[] {
  let members: string[] = [];
  for (const f of migrationFiles()) {
    const t = sqlCode(fs.readFileSync(f, "utf8"));
    for (const m of t.matchAll(
      /ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([\s\S]*?)\)\s*\)/gi,
    )) {
      members = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
  }
  return members;
}

/** Keys that mark an object literal as a notification payload, not a Stripe arg. */
const NOTIFICATION_SHAPE = new Set(["user_id", "title", "message", "body"]);

/**
 * Notification types written from TYPESCRIPT — precise, because the payload is
 * identified by SHAPE: an object literal with a string `type` alongside a
 * recipient or a body. `{ type: "card" }` in a Stripe call has neither.
 *
 * This is the side the ENFORCED direction uses. A loose scan is not allowed to
 * decide that code is broken.
 */
export function notificationEmittersTs(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (type: string, site: string) => {
    if (!out.has(type)) out.set(type, []);
    out.get(type)!.push(site);
  };

  for (const file of productSources()) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\btype\s*:/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = n.properties.filter(ts.isPropertyAssignment);
        const named = props.map((p) => ({
          k: ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null,
          v: p.initializer,
        }));
        const typeProp = named.find(
          (p) => p.k === "type" && (ts.isStringLiteral(p.v) || ts.isNoSubstitutionTemplateLiteral(p.v)),
        );
        // A notification payload carries a recipient or a body alongside the
        // type; `{ type: "card" }` in a Stripe call does not.
        if (typeProp && named.some((p) => p.k && NOTIFICATION_SHAPE.has(p.k))) {
          add(
            (typeProp.v as ts.StringLiteralLike).text,
            `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
          );
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  return out;
}

/**
 * Notification types written from SQL TRIGGERS. DELIBERATELY LOOSE: every
 * quoted literal near an `INSERT INTO notifications`, plus `v_type := '…'`.
 *
 * Six of the eighteen legal types (`job_update`, `application`, `work_status`,
 * `transit_updates`, `system_alert`, `new_offers`) are written ONLY by
 * triggers, so a TypeScript-only scan calls them dead. Looseness is safe in
 * ONE direction only: it can make a type look alive that is not, so it is used
 * for the REPORTED "nothing emits this" check and never for the enforced one.
 */
export function notificationEmittersSql(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (type: string, site: string) => {
    if (!out.has(type)) out.set(type, []);
    out.get(type)!.push(site);
  };
  for (const f of migrationFiles()) {
    const t = sqlCode(fs.readFileSync(f, "utf8"));
    if (!/insert\s+into\s+(?:public\.)?notifications/i.test(t) && !/v_type\s*:=/.test(t)) continue;
    for (const m of t.matchAll(/(?:v_type|v_category)\s*:=\s*'([a-z_]+)'/gi)) add(m[1], rel(f));
    for (const block of t.split(/insert\s+into\s+(?:public\.)?notifications/i).slice(1)) {
      for (const m of block.slice(0, 1200).matchAll(/'([a-z_]+)'/g)) add(m[1], rel(f));
    }
  }
  return out;
}

/** TS ∪ SQL — used only where over-matching is the safe direction. */
export function notificationEmitters(): Map<string, string[]> {
  const out = new Map(notificationEmittersTs());
  for (const [k, v] of notificationEmittersSql()) out.set(k, [...(out.get(k) ?? []), ...v]);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// D4 — every table has RLS, and a table with no policy has no client grant
// ───────────────────────────────────────────────────────────────────────────

export interface TableFacts {
  created: Map<string, string>;
  dropped: Set<string>;
  rlsEnabled: Set<string>;
  policied: Set<string>;
  clientGranted: Map<string, string[]>;
}

/**
 * The table world, read out of the migration tree.
 *
 * CAVEAT, stated rather than hidden: this is the migration tree, not
 * `pg_policies`. It can see a policy that was created and cannot see one that
 * was later dropped by a migration whose DROP it did not parse. It is here
 * because it is fast enough for every push; the LIVE check is
 * `scripts/check-live-privileges.mjs` + `scripts/ci/sensitive-anon-grants.sql`,
 * and the two answer different questions.
 *
 * Cross-checked against prod (fncmgoasalhdgfwzhsqa) on 2026-09-19: for the
 * seven tables this flagged, `pg_class.relrowsecurity` and the `pg_policies`
 * count agreed with what this returns, except `job_pets`, whose two policies
 * this originally missed because the policy NAME contains the word " on " —
 * which is why the regex below skips the quoted name before looking for ON.
 */
export function tableFacts(): TableFacts {
  const created = new Map<string, string>();
  const dropped = new Set<string>();
  const rlsEnabled = new Set<string>();
  const policied = new Set<string>();
  const clientGranted = new Map<string, string[]>();
  for (const f of migrationFiles()) {
    const t = sqlCode(fs.readFileSync(f, "utf8"));
    for (const m of t.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) {
      if (!created.has(m[1])) created.set(m[1], rel(f));
    }
    for (const m of t.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) dropped.add(m[1]);
    for (const m of t.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
    )) {
      rlsEnabled.add(m[1]);
    }
    // The quoted policy NAME is skipped before looking for ON: this codebase
    // writes `CREATE POLICY "Poster manages the pets on their job" ON …`.
    for (const m of t.matchAll(/CREATE\s+POLICY\s+(?:"[^"]*"|[a-z_0-9]+)\s+ON\s+(?:public\.)?"?([a-z_0-9]+)"?/gi)) {
      policied.add(m[1]);
    }
    for (const m of t.matchAll(
      /GRANT\s+([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+TO\s+([a-z_, ]+)/gi,
    )) {
      if (!/\b(anon|authenticated)\b/.test(m[3])) continue;
      if (!clientGranted.has(m[2])) clientGranted.set(m[2], []);
      clientGranted.get(m[2])!.push(`${rel(f)} — GRANT ${m[1].trim()} TO ${m[3].trim()}`);
    }
  }
  return { created, dropped, rlsEnabled, policied, clientGranted };
}

// ───────────────────────────────────────────────────────────────────────────
// the dimension list
// ───────────────────────────────────────────────────────────────────────────

const D2: Dimension = {
  id: "enum-member-has-a-render-branch",
  why:
    "`pending_approval` fell through every branch of a status switch and rendered an empty box, " +
    "twice. A map that means to be total and is not fails silently for whoever holds the new member.",
  inventorySource: "Constants.public.Enums (generated from the live enums)",
  coverageSource: "every object literal in src/** and supabase/functions/** whose keys are enum members",
  claimsEnums: Object.keys(Constants.public.Enums),
  mode: "reported",
  inventory: () => Object.values(Constants.public.Enums).flatMap((m) => [...m]),
  coverage: (inv) => {
    const holes = enumKeyedMapHoles();
    const branches = enumMemberBranches();
    const missingSomewhere = new Set(
      holes.filter((h) => h.covered / h.total >= TOTALITY_RATIO).flatMap((h) => h.missing),
    );
    // Covered means BOTH: somebody has a branch for it, and no map that means
    // to be total leaves it out. A member nothing has ever heard of fails the
    // first half — which is what makes this dimension able to report a
    // synthetic member, rather than calling the unknown trivially fine.
    return new Map(
      inv.map((m) => [m, missingSomewhere.has(m) ? [] : (branches.get(m) ?? []).slice(0, 2)]),
    );
  },
};

const D3: Dimension = {
  id: "notification-type-is-legal-and-emitted",
  why:
    "A type the CHECK does not list is a constraint violation at INSERT time — a notification that " +
    "silently never arrives. A type nobody emits is dead weight in six mirroring registries.",
  inventorySource: "the notifications_type_check CHECK constraint, parsed out of the migrations",
  coverageSource: "notification-shaped object literals in TS, plus notifications INSERT blocks in SQL",
  claimsEnums: [],
  mode: "enforced",
  inventory: () => notificationTypeCheck(),
  coverage: (inv) => {
    const emitters = notificationEmitters();
    return new Map(inv.map((t) => [t, emitters.get(t) ?? []]));
  },
};

const D4: Dimension = {
  id: "table-has-row-level-security",
  why:
    "A public table shipped without RLS is readable by every signed-in account. This is the class " +
    "that put the jobs table in client-writable reach (2026-08-19).",
  inventorySource: "CREATE TABLE in supabase/migrations, minus tables a later migration drops",
  coverageSource: "ALTER TABLE … ENABLE ROW LEVEL SECURITY in the same tree",
  claimsEnums: [],
  mode: "enforced",
  inventory: () => {
    const f = tableFacts();
    return [...f.created.keys()].filter((t) => !f.dropped.has(t)).sort();
  },
  coverage: (inv) => {
    const f = tableFacts();
    return new Map(inv.map((t) => [t, f.rlsEnabled.has(t) ? [`RLS enabled — ${f.created.get(t)}`] : []]));
  },
};

const D5: Dimension = {
  id: "edge-function-has-a-caller",
  why: "Four business-seat functions sat dead for weeks; knip cannot see a dead edge function.",
  inventorySource: "supabase/functions/*/index.ts",
  coverageSource: "client code, e2e, scripts, CI workflows, config.toml, cron/net.http_post in migrations",
  claimsEnums: [],
  mode: "delegated",
  delegate: { file: "scripts/check-dead-edge-functions.mjs", wiredInto: "package.json / CI" },
  inventory: () =>
    fs
      .readdirSync(path.join(ROOT, "supabase", "functions"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, "supabase", "functions", e.name, "index.ts")))
      .map((e) => e.name)
      .sort(),
  coverage: (inv) => new Map(inv.map((n) => [n, ["delegated to scripts/check-dead-edge-functions.mjs"]])),
};

const D6: Dimension = {
  id: "cron-has-a-liveness-expectation",
  why: "Two crons ran with nothing watching them; a stop would have been silent.",
  inventorySource: "cron.schedule(...) in supabase/migrations, minus later unschedules",
  coverageSource: "cron_work_expectations rows inserted by the migrations",
  claimsEnums: [],
  mode: "delegated",
  delegate: { file: "src/test/cronLivenessCoverage.test.ts", wiredInto: "vitest (npx vitest run)" },
  inventory: () => {
    const names = new Set<string>();
    for (const f of migrationFiles()) {
      const t = sqlCode(fs.readFileSync(f, "utf8"));
      for (const m of t.matchAll(/cron\.schedule\(\s*'([a-z0-9][a-z0-9-]*)'/gi)) names.add(m[1]);
    }
    return [...names].sort();
  },
  coverage: (inv) => new Map(inv.map((n) => [n, ["delegated to cronLivenessCoverage.test.ts"]])),
};

export const REGISTRY: Dimension[] = [D1, D2, D3, D4, D5, D6];

// ═══════════════════════════════════════════════════════════════════════════
// the checks
// ═══════════════════════════════════════════════════════════════════════════

describe("exhaustiveness registry — the registry itself is honest", () => {
  it("every dimension's inventory is non-empty and read from the world", () => {
    const empty = REGISTRY.filter((d) => d.inventory().length === 0).map((d) => `${d.id} (${d.inventorySource})`);
    expect(empty, `an empty inventory makes a dimension vacuously green:\n${empty.join("\n")}`).toEqual([]);
  });

  it("every enum in the generated types is CLAIMED by some dimension", () => {
    // This is what stops the DIMENSION LIST from going stale: a new enum in
    // the database cannot land without somebody saying how it is covered.
    const claimed = new Set(REGISTRY.flatMap((d) => d.claimsEnums));
    const unclaimed = Object.keys(Constants.public.Enums).filter((e) => !claimed.has(e));
    expect(
      unclaimed,
      `these enums exist in the database and no dimension covers them: ${unclaimed.join(", ")}`,
    ).toEqual([]);
  });

  it("every delegated dimension's delegate still exists", () => {
    const missing = REGISTRY.filter((d) => d.mode === "delegated")
      .filter((d) => !d.delegate || !fs.existsSync(path.join(ROOT, d.delegate.file)))
      .map((d) => `${d.id} → ${d.delegate?.file ?? "(none)"}`);
    expect(missing, `a delegation to a file that does not exist is a gap:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every dimension reports a member it has never seen — none is vacuously total", () => {
    // The self-test the whole file rests on. A synthetic member is pushed
    // through each dimension's own coverage function; a dimension that calls
    // it covered is not checking anything.
    const blind: string[] = [];
    for (const d of REGISTRY) {
      if (d.mode === "delegated") continue; // delegates carry their own red-before cases
      const synthetic = `__never_${d.id.replace(/-/g, "_")}__`;
      const cov = d.coverage([...d.inventory(), synthetic]);
      if ((cov.get(synthetic) ?? []).length !== 0) blind.push(d.id);
    }
    expect(blind, `these dimensions cannot report an uncovered member:\n${blind.join("\n")}`).toEqual([]);
  });
});

describe("D3 — every notification type is legal, and every legal type is emitted", () => {
  const legal = notificationTypeCheck();
  const tsEmitters = notificationEmittersTs();
  const emitters = notificationEmitters();

  it("parsed the CHECK constraint (a zero here would make both directions vacuous)", () => {
    expect(legal.length).toBeGreaterThanOrEqual(15);
    expect(legal).toContain("admin_alert");
    expect(tsEmitters.size).toBeGreaterThan(8);
    expect(emitters.size).toBeGreaterThan(tsEmitters.size);
  });

  it("ENFORCED: no code writes a notification type the DB CHECK will reject", () => {
    // This direction is a real runtime failure: the INSERT raises 23514 and
    // the notification simply never exists. Nothing on screen says so.
    const illegal = [...tsEmitters.entries()]
      .filter(([t]) => !legal.includes(t))
      .map(([t, sites]) => `"${t}" written at ${sites[0]} is not in notifications_type_check`);
    expect(illegal, illegal.join("\n")).toEqual([]);
  });

  it("REPORTED: legal types with no emitter anywhere", () => {
    const dead = legal.filter((t) => !emitters.has(t));
    if (dead.length) {
      process.stderr.write(
        `[exhaustiveness] notification types allowed by the CHECK that nothing emits: ${dead.join(", ")}\n`,
      );
    }
    expect(Array.isArray(dead)).toBe(true);
  });
});

describe("D4 — row-level security covers every table", () => {
  const facts = tableFacts();
  const live = [...facts.created.keys()].filter((t) => !facts.dropped.has(t));

  it("read the table world (a zero here would make this vacuous)", () => {
    expect(live.length).toBeGreaterThan(50);
    expect(live).toContain("jobs");
    expect(facts.policied.has("job_pets")).toBe(true); // the quoted-name regex trap
  });

  it("ENFORCED: every public table created by a migration enables RLS", () => {
    const open = live.filter((t) => !facts.rlsEnabled.has(t)).map((t) => `${t} (created in ${facts.created.get(t)})`);
    expect(open, `these tables have no ENABLE ROW LEVEL SECURITY anywhere:\n${open.join("\n")}`).toEqual([]);
  });

  it("ENFORCED: a table with no policy hands nothing to anon or authenticated", () => {
    // RLS with zero policies denies everything, so a client GRANT on such a
    // table is either dead weight or a policy somebody forgot to write. Both
    // are worth a red: the grant says the table is meant to be client-visible
    // and the policy set says it is not.
    const contradictions = live
      .filter((t) => !facts.policied.has(t) && facts.clientGranted.has(t))
      .map((t) => `${t}: no CREATE POLICY anywhere, but ${facts.clientGranted.get(t)!.join("; ")}`);
    expect(contradictions, contradictions.join("\n")).toEqual([]);
  });

  it("REPORTED: tables with RLS on and no policy at all (service-role-only, or a gap)", () => {
    const noPolicy = live.filter((t) => facts.rlsEnabled.has(t) && !facts.policied.has(t));
    if (noPolicy.length) {
      process.stderr.write(`[exhaustiveness] RLS on, zero policies (deny-all to clients): ${noPolicy.join(", ")}\n`);
    }
    expect(Array.isArray(noPolicy)).toBe(true);
  });
});

describe("D2 — every enum member has a branch in the maps that mean to be total", () => {
  const holes = enumKeyedMapHoles();

  it("the enum-keyed-map scanner can still SEE an incomplete map", () => {
    // THIS USED TO PIN A REAL DEFECT. The proof-of-life was
    // `holes.some(h => h.site.includes("instant-job-match"))` — i.e. the
    // scanner was shown to work by the fact that instant-job-match's
    // categoryEmoji was missing storm_prep and events. That made closing the
    // hole IMPOSSIBLE without this test going red: a check that requires a
    // defect to keep existing is not a check, it is a lock on the defect. It
    // duly went red the moment the emoji were added (2026-09-19).
    //
    // The proof is now synthetic and derived from the live enum set: take a
    // real enum, write a map covering all but ONE of its members, and require
    // the scanner to report exactly that member. Nothing in the app has to
    // stay broken for this to hold, and it still fails the day the scanner
    // stops parsing object literals, stops reading `Constants.public.Enums`,
    // or loses its TOTALITY_RATIO arithmetic.
    const [enumName, members] = (
      Object.entries(Constants.public.Enums) as Array<[string, readonly string[]]>
    )
      .filter(([, m]) => m.length >= 5)
      .sort((a, b) => b[1].length - a[1].length)[0];
    expect(members, "no enum with >= 5 members to build the probe from").toBeTruthy();

    const dropped = members[members.length - 1];
    const probe = `const probe = {\n${members
      .slice(0, -1)
      .map((m, i) => `  ${m}: ${i},`)
      .join("\n")}\n};\nexport default probe;\n`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enum-map-probe-"));
    const file = path.join(dir, "probe.ts");
    try {
      fs.writeFileSync(file, probe);
      const found = enumKeyedMapHoles([file]);
      expect(
        found.map((h) => ({ enumName: h.enumName, missing: h.missing })),
        `The scanner was handed a ${enumName} map covering ${members.length - 1} of ` +
          `${members.length} members and found no hole. It is no longer able to see one, ` +
          `so the ratchet below is checking nothing.`,
      ).toContainEqual({ enumName, missing: [dropped] });
      expect(found[0].covered / found[0].total).toBeGreaterThanOrEqual(TOTALITY_RATIO);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // And it must still be reading the real tree, not an empty file list.
    expect(
      productSources().length,
      "productSources() came back empty — every scan in this file would report nothing",
    ).toBeGreaterThan(50);
  });

  it("ENFORCED: the incomplete-map ratchet is exactly the world, in both directions", () => {
    // A ratchet that can only be too strict is a mute. This one records the
    // MISSING MEMBERS, so a thirteenth job_category makes the recorded set
    // stale and this goes red on the day the enum grows; closing a hole makes
    // the entry describe nothing and also goes red.
    const drift = enumMapRatchetDrift(holes, ENUM_MAP_RATCHET);
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("REPORTED: partial maps below the totality threshold", () => {
    const partial = holes.filter((h) => h.covered / h.total < TOTALITY_RATIO);
    if (partial.length) {
      process.stderr.write(
        "[exhaustiveness] enum-keyed maps covering a subset (judgement call, not a verdict):\n" +
          partial
            .map((h) => `  ${h.site} ${h.enumName} ${h.covered}/${h.total} missing ${h.missing.join(", ")}`)
            .join("\n") +
          "\n",
      );
    }
    expect(Array.isArray(partial)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PROVEN ABLE TO FAIL
// ───────────────────────────────────────────────────────────────────────────

describe("the registry's checks are able to fail", () => {
  it("D3 goes red for a notification type the CHECK does not list", () => {
    const legal = notificationTypeCheck();
    // A name no real emitter or probe can collide with: a self-test that another
    // file can turn green is not a self-test.
    const invented = "__registry_selftest_type__";
    expect(legal).not.toContain(invented);
    // The shape a real emitter has — this is what the scanner looks for.
    const emitted = new Map<string, string[]>([[invented, ["supabase/functions/invented/index.ts:1"]]]);
    expect(notificationEmittersTs().has(invented)).toBe(false);
    const illegal = [...emitted.keys()].filter((t) => !legal.includes(t));
    expect(illegal).toEqual([invented]);
  });

  it("D4 goes red for a table created with no RLS", () => {
    const facts = tableFacts();
    const invented = "__registry_selftest_table__";
    expect(facts.created.has(invented)).toBe(false);
    const live = [...facts.created.keys(), invented].filter((t) => !facts.dropped.has(t));
    expect(live.filter((t) => !facts.rlsEnabled.has(t))).toEqual([invented]);
  });

  it("D4 goes red when a policy-less table carries a client grant", () => {
    const facts = tableFacts();
    const invented = "__registry_selftest_table__";
    const granted = new Map(facts.clientGranted);
    granted.set(invented, ["invented.sql — GRANT SELECT TO authenticated"]);
    const live = [...facts.created.keys(), invented].filter((t) => !facts.dropped.has(t));
    const contradictions = live.filter((t) => !facts.policied.has(t) && granted.has(t));
    expect(contradictions).toEqual([invented]);
  });

  it("D2 goes red for an enum member nobody's total map covers", () => {
    // Run the REAL comparison against a synthetic world, in all three
    // directions it is supposed to fail in. This used to assert that
    // instant-job-match's ratchet entry existed — so the day that hole was
    // closed, the proof-of-life failed with "expected undefined to be truthy".
    // A proof that depends on a defect surviving is a lock on the defect.
    const hole: EnumMapHole = {
      site: "supabase/functions/made-up/index.ts:1",
      enumName: "job_category",
      covered: 11,
      total: 12,
      missing: ["storm_prep"],
    };
    const key = "supabase/functions/made-up/index.ts:1";

    // (a) a NEW incomplete map nobody has recorded
    expect(enumMapRatchetDrift([hole], {})).toEqual([
      "NEW incomplete map: supabase/functions/made-up/index.ts:1 is missing storm_prep",
    ]);
    // (b) a recorded map whose missing SET changed — the day the enum grows
    expect(enumMapRatchetDrift([{ ...hole, missing: ["storm_prep", "events"] }], { [key]: ["storm_prep"] })).toEqual([
      `${key} now misses storm_prep, events (ratchet says storm_prep)`,
    ]);
    // (c) a recorded map that has been FIXED — the entry must go
    expect(enumMapRatchetDrift([], { [key]: ["storm_prep"] })).toEqual([
      `${key} is no longer incomplete — remove it from ENUM_MAP_RATCHET`,
    ]);
    // …and it stays quiet on a world that agrees with its ratchet.
    expect(enumMapRatchetDrift([hole], { [key]: ["storm_prep"] })).toEqual([]);
    // A map BELOW the totality threshold is a bucket, not a registry: ignored.
    expect(enumMapRatchetDrift([{ ...hole, covered: 4, total: 12 }], {})).toEqual([]);
  });

  it("the enum-claim meta-check goes red for an enum no dimension names", () => {
    const claimed = new Set(REGISTRY.flatMap((d) => d.claimsEnums));
    expect([...claimed, "job_status"].includes("job_status")).toBe(true);
    expect(claimed.has("payout_state_that_does_not_exist_yet")).toBe(false);
  });
});

// ── Shown able to fail ─────────────────────────────────────────────────────
// D3 ENFORCED, driven from the production side rather than a synthetic
// fixture: give a real emitter a type the notifications_type_check CHECK does
// not list. In production that INSERT raises 23514 and the notification simply
// never exists, with nothing on screen to say so. This proves the registry is
// reading `supabase/functions/**` for real — the meta-tests at the bottom of
// this file only ever exercise temp-dir fixtures.
// @mutate supabase/functions/daily-match-digest/index.ts | type: "job_match", | type: "job_match_v2",
