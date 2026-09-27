/*
 * CLASS CHECK — an admin alert about a user_violations flag opens a screen
 * that shows user_violations (Q752, 2026-09-27).
 *
 * FOUND 2026-09-27. apply_low_rating_flag wrote a user_violations row and told
 * every admin "Low rating alert", linking '/admin?view=fraud&user=<id>'. The
 * fraud dashboard reads only fraud_flags, so the admin landed on a screen
 * with no trace of the flag. Measured live: the function's link was
 * view=fraud, and AdminFraudDashboard.tsx queries fraud_flags only.
 *
 * THE CHECK. For every function as the database runs it (effectiveDefs replays
 * every migration, rewrites included) that inserts into user_violations AND
 * writes a notification link '/admin?view=<v>…', the screen Admin.tsx renders
 * for <v> (its component file plus everything it imports under src/) must
 * read user_violations. Found from the migrations, not from a list; at least
 * one producer must be found, so the check cannot pass on nothing.
 *
 * Shown red (2026-09-27) with 20260927060952 removed: apply_low_rating_flag
 * -> view=fraud (AdminFraudDashboard) does not read user_violations.
 *
 * @mutate supabase/migrations/20260927060952_low_rating_alert_links_person.sql | '/admin?view=people&user=' \|\| p_reviewee_id, | '/admin?view=fraud&user=' \|\| p_reviewee_id,
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");
const ADMIN = join(SRC, "pages", "admin", "Admin.tsx");
const MIGRATIONS = join(REPO, "supabase", "migrations");

const WRITES_VIOLATION = /\binsert\s+into\s+(?:public\.)?user_violations\b/i;
const WRITES_NOTIFICATION = /\binsert\s+into\s+(?:public\.)?notifications\b/i;
const ADMIN_LINK = /'\/admin\?view=([a-z]+)/g;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith("/")) {
      try {
        readFileSync(p, "utf8");
        return p;
      } catch {
        /* a directory */
      }
    }
  }
  return null;
}

/** The component file and every file it imports under src/, transitively. */
function screenFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.includes("/integrations/supabase/types")) stack.push(r);
    }
  }
  return seen;
}

/** view id -> the component file Admin.tsx renders for it. */
function viewScreens(): Map<string, string> {
  const admin = readFileSync(ADMIN, "utf8");
  const out = new Map<string, string>();
  for (const m of admin.matchAll(/case\s+"([a-z]+)":\s*return\s+<(\w+)/g)) {
    const [, view, comp] = m;
    const imp =
      admin.match(new RegExp(`const\\s+${comp}\\s*=\\s*lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*"([^"]+)"`)) ??
      admin.match(new RegExp(`import\\s+(?:\\{[^}]*\\b${comp}\\b[^}]*\\}|${comp})\\s+from\\s+"([^"]+)"`));
    const file = imp && resolveImport(ADMIN, imp[1]);
    if (file) out.set(view, file);
  }
  return out;
}

describe("an admin alert about a user_violations flag opens a screen that shows it (Q752)", () => {
  const screens = viewScreens();
  const producers: { fn: string; view: string }[] = [];
  for (const [fn, def] of effectiveDefs(MIGRATIONS)) {
    const body = blankSqlComments(def.stmt);
    if (!WRITES_VIOLATION.test(body) || !WRITES_NOTIFICATION.test(body)) continue;
    for (const m of body.matchAll(ADMIN_LINK)) producers.push({ fn, view: m[1] });
  }

  it("finds the producers and the admin screens (not vacuous)", () => {
    expect(screens.get("people")).toBeTruthy();
    expect(screens.get("fraud")).toBeTruthy();
    expect(producers.some((p) => p.fn.startsWith("apply_low_rating_flag"))).toBe(true);
  });

  it("every such link's screen reads user_violations", () => {
    const bad: string[] = [];
    for (const { fn, view } of producers) {
      const entry = screens.get(view);
      if (!entry) {
        bad.push(`${fn} -> view=${view}: no screen for that view in Admin.tsx`);
        continue;
      }
      const reads = [...screenFiles(entry)].some((f) => /\buser_violations\b/.test(readFileSync(f, "utf8")));
      if (!reads) bad.push(`${fn} -> view=${view} (${entry.slice(REPO.length + 1)}) does not read user_violations`);
    }
    expect(bad).toEqual([]);
  });
});
