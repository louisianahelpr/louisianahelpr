import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * EVERY ADMIN DEEP LINK AN EDGE FUNCTION EMITS MUST RESOLVE TO A SCREEN.
 *
 * The bug this exists for: `stalled-completion-reminder` and
 * `arrival-confirm-reminder` both told every admin to open `/admin?job=<id>`.
 * `src/pages/admin/Admin.tsx` routes on `?view=` and nothing else, so `?job=` was
 * read by nobody, the console fell through to `home`, and the alert about a
 * specific stuck job opened the dashboard. Twelve `/admin?tab=payouts` /
 * `?tab=disputes` Slack links from the money functions were dead the same way
 * (`?tab=` is read only by AdminUsers, which only mounts under `?view=people`).
 * Nothing failed — the notification wrote fine, the link just went nowhere.
 *
 * WHY THIS IS NOT A LIST CHECKED AGAINST ITSELF.
 * `docs/lessons` has the scar: a registry that is both the input and the oracle
 * cannot fail. So neither side of this is written down here. Both are parsed
 * out of the world, from two repos-worth of unrelated source:
 *
 *   EMITTED  — every string literal under `supabase/functions/**` that contains
 *              an `/admin` path. Comment-aware, so prose about `/admin` in a
 *              code comment is not mistaken for a link (and the scanner asserts
 *              it ended in code state, so a desync fails loudly instead of
 *              quietly finding nothing).
 *   HANDLED  — `src/pages/admin/Admin.tsx`: the real `type View` union, the real
 *              `VIEW_LABELS` keys and the params `Admin.tsx` itself reads,
 *              plus every param any `src/components/admin/**` component calls
 *              `searchParams.get()` for.
 *
 * THE TWO RULES, and why they stop where they do:
 *
 *   1. A link with a query string MUST carry a `?view=` that is a real view.
 *      This is the defect class itself: `?view=` is the only thing /admin
 *      routes on, so anything else alone lands on the dashboard.
 *   2. Every other param must be one the admin console actually reads
 *      SOMEWHERE. `?job=` is real (AdminJobs.tsx reads it); `?payout=` is not.
 *
 * A third rule — "the param must be read by the component THAT view mounts" —
 * was written, went red, and was deliberately dropped. `auto-resolve-disputes`
 * sends `/admin?view=disputes&job=<id>`, and AdminDisputes reads no params, so
 * the strict rule called it dead. It is not: that link is the admin reminder's
 * DEDUPE KEY (`reminderKey(userId, title, link)`), and flattening it to
 * `?view=disputes` made one job's reminder suppress every other job's for 24h —
 * caught by auto-resolve-disputes.test.ts. A param can be load-bearing for
 * something other than routing, so the guard does not assume otherwise. See the
 * "not yet honoured" report below for the one-line fix that would make that
 * `&job=` actually open the dispute.
 *
 * So a new alert pointing at a view that does not exist, or hanging an
 * invented param on a real one, fails the day it is written — with no list for
 * anyone to remember to update.
 *
 * SHOWN ABLE TO FAIL, 2026-09-20. Both sides of the contract were mutated and
 * both went red: re-introducing the original `/admin?job=<id>` bug in
 * stalled-completion-reminder, and deleting the `?job=` READER in AdminJobs —
 * which is what makes rule 2 derived from the world rather than from a list in
 * this file.
 *
 * COVERAGE LIMIT, on the record: this is a source contract. It proves a link
 * CAN resolve, not that the deployed function emits it or that the console
 * renders it; and the deliberately-dropped third rule (the param must be read
 * by the component THAT view mounts) means `/admin?view=people&job=x` passes
 * while opening nothing. See the "not yet honoured" note at the foot.
 *
 * @mutate supabase/functions/stalled-completion-reminder/index.ts | `/admin?view=stalled&job=${job.id}` | `/admin?job=${job.id}`
 * @mutate src/components/admin/AdminJobs.tsx | const target = searchParams.get("job"); | const target = searchParams.get("jobIdParamRemoved");
 */

const REPO = resolve(__dirname, "..", "..");
const ADMIN_PAGE = join(REPO, "src/pages/admin/Admin.tsx");
const EDGE_ROOT = join(REPO, "supabase/functions");

/* ------------------------------------------------------------------ */
/* Side 1: what the edge functions EMIT                                */
/* ------------------------------------------------------------------ */

interface EmittedLink {
  file: string;
  line: number;
  /** The literal as written, with `${...}` collapsed to `{}`. */
  raw: string;
}

/**
 * Pull every string / template literal out of a TS source, skipping `//` and
 * `/* *\/` comments, and collapsing `${...}` interpolations to `{}` so
 * `/admin?view=people&user=${id}` reads as `/admin?view=people&user={}`.
 *
 * Returns `null` if the scan desynced (ended inside a string or comment),
 * which the caller turns into a failure rather than a silent zero.
 */
function scanLiterals(src: string): { value: string; line: number }[] | null {
  const out: { value: string; line: number }[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const isRegexPosition = (): boolean => {
    // Walk back over whitespace to the previous significant char. A `/` that
    // follows a value-ending token is division; anything else starts a regex.
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    const c = src[j];
    if (/[A-Za-z0-9_$)\]]/.test(c)) {
      // Could still be `return /re/` etc. — check for a keyword.
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
      const word = src.slice(k + 1, j + 1);
      return ["return", "typeof", "case", "in", "of", "do", "else", "yield", "await"].includes(word);
    }
    return true;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "/" && isRegexPosition()) {
      // Regex literal: skip it whole so a `//` inside it is not a comment.
      i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        else if (d === "\n") break; // not a regex after all; bail safely
        i++;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      let value = "";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          value += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "\n") return null; // unterminated — desync
        value += src[i];
        i++;
      }
      i++;
      out.push({ value, line: startLine });
      continue;
    }
    if (c === "`") {
      const startLine = line;
      let value = "";
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          value += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "`") break;
        if (src[i] === "$" && src[i + 1] === "{") {
          // Skip the interpolation, tracking nesting (and nested literals).
          value += "{}";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const d = src[i];
            if (d === "{") depth++;
            else if (d === "}") depth--;
            else if (d === "\n") line++;
            else if (d === '"' || d === "'" || d === "`") {
              const q = d;
              i++;
              while (i < n && src[i] !== q) {
                if (src[i] === "\\") i++;
                else if (src[i] === "\n") line++;
                i++;
              }
            }
            i++;
          }
          continue;
        }
        if (src[i] === "\n") line++;
        value += src[i];
        i++;
      }
      i++;
      out.push({ value, line: startLine });
      continue;
    }
    i++;
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(p);
  }
  return acc;
}

/**
 * `/admin` as the START of a path, optionally behind an origin — never the
 * `/admin` segment of some other API path. `${appUrl}/admin?view=…` counts
 * (the interpolation has already been collapsed to `{}`); Supabase's own
 * `/auth/v1/admin/users/<id>` does NOT, because its prefix contains a slash.
 */
const ADMIN_SEGMENT = /\/admin(?![A-Za-z0-9_-])/g;
const ORIGIN_ONLY = /^(?:\{\}|https?:\/\/[^/]*)$/;

/** Every `/admin…` path inside one string literal, or [] if it holds none. */
function adminPathsIn(value: string): string[] {
  const found: string[] = [];
  ADMIN_SEGMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADMIN_SEGMENT.exec(value)) !== null) {
    const prefix = value.slice(0, m.index);
    if (prefix !== "" && !ORIGIN_ONLY.test(prefix)) continue;
    const rest = value.slice(m.index);
    found.push(rest.split(/[\s"'`)]/)[0]);
  }
  return found;
}

function collectEmittedAdminLinks(): { links: EmittedLink[]; scanned: number } {
  const files = walk(EDGE_ROOT);
  const links: EmittedLink[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(REPO.length + 1);
    if (file.endsWith(".tsx")) {
      // JSX email templates: a bare apostrophe in a text node ("don't") is not
      // a string literal, so the scanner cannot run here. None of them carries
      // an admin URL today — they are recipient-facing — so a raw match over
      // the whole file is the right net: it costs nothing while the count is
      // zero, and the day someone puts an admin link in an ops email it lands
      // in the same contract as every other emitted link.
      for (const raw of adminPathsIn(src.replace(/\$\{[^}]*\}/g, "{}"))) {
        links.push({ file: rel, line: 0, raw });
      }
      continue;
    }
    const literals = scanLiterals(src);
    // A desync must fail the guard, not silently shrink its input.
    expect(literals, `literal scan desynced in ${file}`).not.toBeNull();
    for (const lit of literals!) {
      for (const raw of adminPathsIn(lit.value)) {
        links.push({ file: rel, line: lit.line, raw });
      }
    }
  }
  return { links, scanned: files.length };
}

/* ------------------------------------------------------------------ */
/* Side 2: what the admin console actually HANDLES                     */
/* ------------------------------------------------------------------ */

function paramsReadBy(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(?:searchParams|params|query)\.get\(\s*["'`]([A-Za-z0-9_-]+)["'`]\s*\)/g)) {
    out.add(m[1]);
  }
  return out;
}

interface AdminConsole {
  views: Set<string>;
  labelled: Set<string>;
  /** Params `src/pages/admin/Admin.tsx` itself routes on. */
  topLevelParams: Set<string>;
  /** Every param ANY admin-console component reads, derived by walking them. */
  consoleParams: Set<string>;
  /** Which file each param came from, for a failure message worth reading. */
  paramSource: Map<string, string>;
}

function parseAdminConsole(): AdminConsole {
  const src = readFileSync(ADMIN_PAGE, "utf8");

  // The real `type View` union.
  const unionMatch = src.match(/type\s+View\s*=\s*([^;]+);/);
  if (!unionMatch) throw new Error("could not find `type View` in src/pages/admin/Admin.tsx");
  const views = new Set(
    [...unionMatch[1].matchAll(/["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]),
  );

  // The real VIEW_LABELS keys — Admin.tsx's own "is this a real view?" oracle,
  // parsed separately from the union so a drift between them fails too.
  const labelsMatch = src.match(/VIEW_LABELS\s*:\s*Record<View,\s*string>\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!labelsMatch) throw new Error("could not find VIEW_LABELS in src/pages/admin/Admin.tsx");
  const labelled = new Set(
    [...labelsMatch[1].matchAll(/(?:^|[,{]\s*)\n?\s*([A-Za-z0-9_]+)\s*:/g)].map((m) => m[1]),
  );

  const topLevelParams = paramsReadBy(src);

  // Every param the console reads anywhere — walked out of the component tree,
  // not listed here. Add a `searchParams.get("x")` to any admin component and
  // `?x=` becomes a legal deep-link param on its own; delete the last reader
  // and every link still carrying it goes red.
  const consoleParams = new Set(topLevelParams);
  const paramSource = new Map<string, string>();
  for (const p of topLevelParams) paramSource.set(p, "src/pages/admin/Admin.tsx");
  for (const file of walk(join(REPO, "src/components/admin"))) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const p of paramsReadBy(readFileSync(file, "utf8"))) {
      if (!paramSource.has(p)) paramSource.set(p, file.slice(REPO.length + 1));
      consoleParams.add(p);
    }
  }

  return { views, labelled, topLevelParams, consoleParams, paramSource };
}

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

/** Every reason this link cannot resolve, or [] if it can. */
function violationsFor(raw: string, console_: AdminConsole): string[] {
  const problems: string[] = [];
  const qIndex = raw.indexOf("?");
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  if (path !== "/admin" && !path.startsWith("/admin/")) return problems; // not a console link
  if (path !== "/admin") {
    problems.push(`"${raw}" — /admin has no sub-routes; the console is one route addressed by ?view=`);
    return problems;
  }
  if (qIndex === -1) return problems; // bare /admin → home, always fine

  const params = new Map<string, string>();
  for (const pair of raw.slice(qIndex + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    params.set(eq === -1 ? pair : pair.slice(0, eq), eq === -1 ? "" : pair.slice(eq + 1));
  }

  // Rule 1 — a query string without a real ?view= is the defect class itself.
  const view = params.get("view");
  if (!console_.topLevelParams.has("view")) {
    problems.push(`"${raw}" — Admin.tsx no longer reads ?view= at all`);
  } else if (view === undefined) {
    problems.push(
      `"${raw}" — no ?view=. Admin.tsx routes on ?view= alone, so this lands on the ` +
        `dashboard home and ${[...params.keys()].map((k) => `?${k}=`).join(", ")} is read by nobody.`,
    );
  } else if (!view.includes("{") && !console_.views.has(view)) {
    problems.push(
      `"${raw}" — ?view=${view} is not in Admin.tsx's View union ` +
        `(known: ${[...console_.views].sort().join(", ")})`,
    );
  }

  // Rule 2 — any other param must be one the console actually reads.
  for (const [key] of params) {
    if (key === "view") continue;
    if (!console_.consoleParams.has(key)) {
      problems.push(
        `"${raw}" — ?${key}= is read by no admin component ` +
          `(the console reads: ${[...console_.consoleParams].sort().join(", ")})`,
      );
    }
  }
  return problems;
}

describe("admin deep links emitted by edge functions", () => {
  const console_ = parseAdminConsole();
  const { links, scanned } = collectEmittedAdminLinks();

  it("parsed a real admin console out of src/pages/admin/Admin.tsx", () => {
    // Anti-vacuity: if either parser silently returns nothing, the contract
    // below passes without checking anything. Pin the shape of the world.
    expect(console_.views.size).toBeGreaterThanOrEqual(20);
    expect([...console_.labelled].sort()).toEqual([...console_.views].sort());
    expect(console_.topLevelParams).toContain("view");
    expect(console_.views).toContain("stalled");
    // The sub-view params this repo deep-links on, proven to come from the
    // components themselves (AdminJobs / AdminUsers) rather than from a list
    // in this file — which is what stops the guard grading its own homework.
    expect(console_.paramSource.get("job")).toBe("src/components/admin/AdminJobs.tsx");
    expect(console_.paramSource.get("user")).toBe("src/components/admin/AdminUsers.tsx");
    expect(console_.consoleParams.size).toBeGreaterThanOrEqual(4);
  });

  it("found the edge functions' admin links, comments excluded", () => {
    expect(scanned).toBeGreaterThanOrEqual(100);
    expect(links.length).toBeGreaterThanOrEqual(30);
    const raws = links.map((l) => l.raw);
    // Emitted links are present…
    expect(raws).toContain("/admin?view=stalled&job={}");
    expect(raws.some((r) => r.startsWith("/admin?view=jobs&job="))).toBe(true);
    // …and prose about /admin in a comment is NOT (send-push-notification's
    // category.ts documents "/admin 627 · /home 619" in a block comment).
    expect(links.some((l) => l.file.endsWith("send-push-notification/category.ts"))).toBe(false);
  });

  it("every emitted admin link resolves to a view the console renders", () => {
    const failures: string[] = [];
    for (const link of links) {
      for (const problem of violationsFor(link.raw, console_)) {
        failures.push(`${link.file}:${link.line}: ${problem}`);
      }
    }
    expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
  });

  it("catches a newly-invented bad link (proof this guard can fail)", () => {
    // Exactly the shapes that shipped broken, plus a plausible future one.
    const bad = [
      "/admin?job=abc-123", // the stalled + arrival escalation bug
      "/admin?tab=payouts", // the twelve money-function Slack links
      "/admin?view=arrivals&job=abc", // a view nobody built
      "/admin?view=payouts&payout=abc", // real view, invented param
      "/admin/stalled", // a sub-route /admin does not have
    ];
    for (const raw of bad) {
      expect(violationsFor(raw, console_), raw).not.toEqual([]);
    }
    // And the shapes that are genuinely fine must stay fine, or the guard is
    // just noise that will be turned off.
    for (const raw of [
      "/admin",
      "/admin?view=stalled",
      "/admin?view=payouts",
      "/admin?view=jobs&job={}",
      "/admin?view=people&user={}",
      // Lands on the Disputes queue; the &job= is the reminder dedupe key.
      "/admin?view=disputes&job={}",
    ]) {
      expect(violationsFor(raw, console_), raw).toEqual([]);
    }
  });
});

/*
 * NOT YET HONOURED — one line, in a file this lane does not own.
 *
 * `auto-resolve-disputes` sends `/admin?view=disputes&job=<id>` five times
 * (index.ts:272, 299, 366, 464, 860). The view is right and the id must stay
 * (it is the reminder dedupe key), but AdminDisputes.tsx calls useSearchParams
 * never, so the admin still lands on the whole queue rather than that dispute.
 * The fix is AdminJobs.tsx:161-171 copied into AdminDisputes.tsx — read
 * `?job=`, open that dispute once the list has loaded, strip the param. Rule 2
 * above starts enforcing it automatically the moment that read exists.
 */
