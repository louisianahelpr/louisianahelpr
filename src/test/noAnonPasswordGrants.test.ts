/*
 * CLASS GUARD: no test harness signs in with an anon password grant.
 * (docs/OPEN.md Q1314, Cloudflare Turnstile + Supabase Auth CAPTCHA.)
 *
 * WHY. Once Auth CAPTCHA is switched on, GoTrue refuses every anon
 * `POST /auth/v1/token?grant_type=password` that carries no Turnstile token
 * (supabase/auth internal/api/middleware.go verifyCaptcha; only an admin
 * bearer or the refresh_token / pkce / id_token grants skip it). A harness has
 * no widget to get a token from. On origin/main of 2026-10-06 every CI journey,
 * sweeper and probe signed the shared test accounts in exactly that way, so the
 * switch would have turned all of them red at once. They now mint their
 * sessions with the service role through ONE helper,
 * scripts/lib/adminSession.mjs (admin generate_link + POST /verify, neither
 * behind the captcha middleware).
 *
 * Inventory from source: every tracked code file under e2e/, scripts/ and
 * .github/ (JS/TS with comments blanked by blankComments; shell and YAML with
 * blankHashComments), and every workflow job that holds a shared test account.
 *   1. RAW GRANTS: no password-grant URL, body or supabase-js
 *      signInWithPassword call. Allowlist: EMPTY.
 *   2. TYPED PASSWORDS: no e2e spec reads a PLAYWRIGHT_*_PASSWORD secret (it
 *      can only be typed into the app's login form, which the same CAPTCHA
 *      refuses from a CI build). Allowlist: exact, two-way, each entry filed.
 *   3. WORKFLOWS: a job holding a shared account's email gets the service-role
 *      key (./.github/actions/service-role-key, or a step that writes
 *      SUPABASE_SERVICE_ROLE_KEY) BEFORE its first step that signs in.
 *
 * RED on origin/main 3ebe11890 (the pre-change sources): see the commit
 * message for the counts.
 */

// @mutate scripts/e2e/mint-poster-token.sh | TOKEN=$(node "$HERE/../lib/adminSession.mjs" "$POSTER_EMAIL" 2>"$ERR") | TOKEN=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -d "{}" 2>"$ERR")
// @mutate e2e/prod-gift-card.spec.ts | async function signIn(api: APIRequestContext, email: string): Promise<Session> { | async function signIn(api: APIRequestContext, email: string): Promise<Session> {\n  await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { data: { email } });
// @mutate scripts/audit/pressProdSafety.mjs | session = await mintAdminSession({ email, serviceKey, supabaseUrl: supabaseUrl(), anonKey: anonKey() }); | session = (await globalThis.client.auth.signInWithPassword({ email, password: "x" })).data.session;
// @mutate e2e/journeys/03-account.spec.ts | const fresh = await getSession(request, "helper", true); | const fresh = await getSession(request, "helper", true); void process.env.PLAYWRIGHT_HELPER_PASSWORD;
// @mutate scripts/lib/adminSession.mjs | { type: "recovery", email }, fetchTransport); | { type: "recovery", email });
// @mutate .github/workflows/slow-network.yml |         uses: ./.github/actions/service-role-key | uses: ./.github/actions/local-preview

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");

const JS = /\.(?:[cm]?js|[cm]?ts|tsx)$/;
const HASH = /\.(?:sh|bash|ya?ml)$/;

/** Code text of a tracked file, comments blanked; null for a file type this guard does not read. */
function code(rel: string): string | null {
  const src = readFileSync(join(ROOT, rel), "utf8");
  if (JS.test(rel)) return blankComments(src);
  if (HASH.test(rel)) return blankHashComments(src);
  return null;
}

/** Tracked files under the given top-level directories, from the git index (nothing transient). */
function tracked(...dirs: string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...dirs], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)))
    .sort();
}

const SCANNED = tracked("e2e", "scripts", ".github").filter((f) => code(f) !== null);

/** Rule 1: the shapes an anon password grant takes in this repo's languages. */
const RAW_GRANT: { name: string; re: RegExp }[] = [
  { name: "token?grant_type=password URL", re: /auth\/v1\/token\?(?:[^\s'"`]*&)?grant_type=password/ },
  { name: "grant_type: 'password' body", re: /\bgrant_type['"]?\s*:\s*['"`]password['"`]/ },
  { name: "('grant_type', 'password') pair", re: /['"]grant_type['"]\s*,\s*['"]password['"]/ },
  { name: "curl -d grant_type=password", re: /(?:\s-d|--data(?:-raw|-urlencode)?|\s-F)\s+['"]?grant_type=password/ },
  { name: "supabase-js signInWithPassword(", re: /\.signInWithPassword\s*\(/ },
];

/** Rule 2: an e2e spec reading a shared password secret (only ever typed into the login form). */
const READS_PASSWORD_SECRET = /process\.env(?:\.PLAYWRIGHT_\w*_PASSWORD\b|\[\s*[`'"]PLAYWRIGHT_[^\]]*_PASSWORD[`'"]\s*\])/;

/**
 * EXACT and two-way, and EMPTY since Q1420 (2026-10-07): no spec reads a shared
 * password secret. The three that used to type one into the app's login form
 * (auth.spec.ts, payment-lifecycle.spec.ts, the slow-network sign-in steps)
 * still drive the form, and their grant is answered with a minted session by
 * e2e/helpers/mintedPasswordGrant.ts, because the CAPTCHA (Q1314) refuses a CI
 * build's password grant. A new reader fails here.
 */
const TYPED_PASSWORD_LOGINS: Record<string, string> = {};

function rawGrantOffenders(): string[] {
  const out: string[] = [];
  for (const f of SCANNED) {
    const text = code(f)!;
    for (const { name, re } of RAW_GRANT) {
      const g = new RegExp(re.source, "g");
      for (const m of text.matchAll(g)) out.push(`${f}:${text.slice(0, m.index).split("\n").length} ${name}`);
    }
  }
  return out;
}

function passwordSecretReaders(): string[] {
  return SCANNED.filter((f) => f.startsWith("e2e/") && JS.test(f) && READS_PASSWORD_SECRET.test(code(f)!));
}

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = { steps?: Step[]; env?: Record<string, string> };

/** A step that signs a shared test account in (or runs something that does). */
const SIGNS_IN = /\bplaywright test\b|sweep-both-seats\.sh|mint-poster-token\.sh|press-wave\.sh|loading-states:measure|npm run vacuity/;
const HOLDS_ACCOUNT = /secrets\.PLAYWRIGHT_(?:POSTER|HELPER|ADMIN|INCOMPLETE)_EMAIL\b/;
const providesKey = (s: Step) =>
  s.uses === "./.github/actions/service-role-key" ||
  (typeof s.run === "string" && /SUPABASE_SERVICE_ROLE_KEY/.test(s.run) && /GITHUB_ENV|\.env\b/.test(s.run));

function accountJobs(): { where: string; signsIn: boolean; problem: string | null }[] {
  const dir = ".github/workflows";
  return tracked(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => {
      const doc = parse(readFileSync(join(ROOT, f), "utf8")) as { env?: Record<string, string>; jobs?: Record<string, Job> };
      const wide = HOLDS_ACCOUNT.test(JSON.stringify(doc.env ?? {}));
      return Object.entries(doc.jobs ?? {})
        .filter(([, j]) => wide || HOLDS_ACCOUNT.test(JSON.stringify(j)))
        .map(([name, j]) => {
          const steps = j.steps ?? [];
          const first = steps.findIndex((s) => typeof s.run === "string" && SIGNS_IN.test(s.run));
          if (first === -1) return { where: `${f} › ${name}`, signsIn: false, problem: null };
          const key = steps.findIndex(providesKey);
          const problem =
            key === -1
              ? `no step provides SUPABASE_SERVICE_ROLE_KEY, but step ${first} (${steps[first].name ?? "unnamed"}) signs in`
              : key > first
                ? `the key arrives at step ${key}, after step ${first} (${steps[first].name ?? "unnamed"}) signs in`
                : null;
          return { where: `${f} › ${name}`, signsIn: true, problem };
        });
    });
}

describe("no test harness signs in with an anon password grant (Q1314)", () => {
  it("inventories the harness code it scans (floor)", () => {
    expect(SCANNED.length).toBeGreaterThan(400);
    expect(SCANNED).toContain("scripts/lib/adminSession.mjs");
    expect(SCANNED).toContain("scripts/e2e/mint-poster-token.sh");
    expect(SCANNED).toContain(".github/workflows/e2e-journeys.yml");
  });

  it("the patterns see every shape they name (synthetic controls)", () => {
    const shapes = [
      "await api.post(`${URL}/auth/v1/token?grant_type=password`, {})",
      'fetch(url, { body: JSON.stringify({ grant_type: "password" }) })',
      'params.set("grant_type", "password")',
      'curl -X POST "$URL/auth/v1/token" -d grant_type=password',
      "await supabase.auth.signInWithPassword({ email, password })",
    ];
    shapes.forEach((s, i) => expect(RAW_GRANT[i].re.test(s), RAW_GRANT[i].name).toBe(true));
    // Not grants: the request meter's own regex, a refresh grant, a comment.
    expect(RAW_GRANT.some(({ re }) => re.test(String.raw`/\/auth\/v1\/token\?(?:.*&)?grant_type=password\b/`))).toBe(false);
    expect(RAW_GRANT.some(({ re }) => re.test("`${URL}/auth/v1/token?grant_type=refresh_token`"))).toBe(false);
    expect(RAW_GRANT.some(({ re }) => re.test(blankComments("// POST /auth/v1/token?grant_type=password\n")))).toBe(false);
    expect(RAW_GRANT.some(({ re }) => re.test(blankHashComments("# curl $URL/auth/v1/token?grant_type=password\n")))).toBe(false);
    expect(READS_PASSWORD_SECRET.test("const p = process.env.PLAYWRIGHT_POSTER_PASSWORD;")).toBe(true);
    expect(READS_PASSWORD_SECRET.test("process.env[`PLAYWRIGHT_${R}_PASSWORD`]")).toBe(true);
  });

  it("no raw password grant anywhere in e2e/, scripts/ or .github/ (allowlist: empty)", () => {
    expect(rawGrantOffenders()).toEqual([]);
  });

  it("only the filed login-form specs read a shared password secret (exact, two-way)", () => {
    expect(passwordSecretReaders()).toEqual(Object.keys(TYPED_PASSWORD_LOGINS).sort());
  });

  it("the service-role generate_link call never goes through a caller's (traced) transport", () => {
    // Playwright traces copy request headers verbatim into trace.zip, which CI
    // uploads on failure from a PUBLIC repo (lh-authz-rls review 2026-10-06):
    // the service-role header must only ever leave through node fetch.
    const src = readFileSync("scripts/lib/adminSession.mjs", "utf8");
    const call = /send\(\s*"\/auth\/v1\/admin\/generate_link"[\s\S]*?\)\s*;/.exec(src);
    expect(call, "the generate_link call in adminSession.mjs").not.toBeNull();
    expect(call![0]).toMatch(/,\s*fetchTransport\s*\)\s*;$/);
  });

  it("every job holding a shared test account has the service-role key before it signs in", () => {
    const jobs = accountJobs();
    expect(jobs.filter((j) => j.signsIn).length, "jobs that sign in (floor)").toBeGreaterThan(15);
    expect(jobs.filter((j) => j.problem).map((j) => `${j.where}: ${j.problem}`)).toEqual([]);
  });
});
