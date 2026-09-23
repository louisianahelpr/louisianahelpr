// @mutate .husky/pre-commit | node scripts/secret-scan.mjs --staged |
// @mutate scripts/lib/secretShapes.mjs | sb_secret_[A-Za-z0-9_-]{20,} | sb_secretZZ_[A-Za-z0-9_-]{20,}
// @mutate .github/workflows/secret-scan.yml | --exit-code 1 | --exit-code 0
/*
 * Q75: a secret can never land.
 *
 * Many agent sessions commit here, and a key committed once stays in history
 * after deletion. The gate is .gitleaks.toml + scripts/lib/secretShapes.mjs,
 * run by the pre-commit hook (scripts/secret-scan.mjs --staged) and by
 * .github/workflows/secret-scan.yml on every push and PR. This proves:
 *   - every repo key shape catches a planted FAKE of that shape, and the
 *     public-by-design values (publishable key, anon JWT, MapKit token) pass;
 *   - gitleaks' [[rules]] and the node shapes are the same list, so the hook
 *     and CI cannot disagree;
 *   - the hook and the workflow are wired, and fail (not warn) on a finding;
 *   - the scanner never prints the value it found.
 *
 * The fakes are ASSEMBLED at runtime from pieces, so this file itself holds no
 * key-shaped literal for gitleaks to trip on.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { SECRET_SHAPES, ALLOWED_MATCHES, ALLOWED_LINES, scanText } from "../../scripts/lib/secretShapes.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object) =>
  [b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), b64url(JSON.stringify(payload)), "FAKEsig" + "0FAKEsig0FAKEsig0FAKE"].join(".");
const F = (n: number) => "FAKE0".repeat(Math.ceil(n / 5)).slice(0, n);

/** One obviously fake value per shape id. A new shape without a fake here fails. */
const FAKES: Record<string, string> = {
  "lh-supabase-secret-key": "sb_" + "secret_" + F(30),
  "lh-supabase-service-role-jwt": jwt({ iss: "supabase", ref: "fakefakefakefakefake", role: "service" + "_role", iat: 1, exp: 2 }),
  "lh-supabase-access-token": "sbp_" + "fa4e".repeat(10),
  "lh-supabase-signed-storage-url":
    "https://fake.supabase.co/storage/v1/object/sign/proof-photos/fake.png?token=" + jwt({ url: "proof-photos/fake.png", exp: 2 }),
  "lh-stripe-secret-key": "sk_" + "live_" + F(40),
  "lh-stripe-webhook-secret": "whsec" + "_" + F(32),
  "lh-resend-api-key": "re" + "_FAKE0FAK_" + F(24),
  "lh-sentry-token": "sntry" + "s_" + F(40),
  "lh-private-key-body": "-----BEGIN " + "PRIVATE KEY-----\n" + F(64) + "\n-----END " + "PRIVATE KEY-----",
  "lh-github-token": "ghp" + "_" + F(36),
  "lh-google-api-key": "AI" + "za" + F(35),
};
// Other variants of a shape that must also be caught.
const MORE_FAKES: [string, string][] = [
  ["lh-stripe-secret-key", "rk_" + "test_" + F(40)],
  ["lh-stripe-secret-key", "sk_" + "test_" + F(40)],
  ["lh-sentry-token", "sntry" + "u_" + F(64)],
  ["lh-github-token", "github" + "_pat_" + F(60)],
  ["lh-private-key-body", `APPLE_P8: "-----BEGIN ${"PRIVATE KEY"}-----\\n${F(60)}\\n-----END PRIVATE KEY-----"`],
  // Payload key order moves "role" to another base64 alignment; all three are covered.
  ["lh-supabase-service-role-jwt", jwt({ role: "service" + "_role", iss: "supabase" })],
  ["lh-supabase-service-role-jwt", jwt({ ref: "fakefakefakefakefake", role: "service" + "_role" })],
  ["lh-supabase-service-role-jwt", jwt({ a: 1, role: "service" + "_role" })],
];

/** Public by design, or not a key at all: must NOT be flagged. */
const ALLOWED_SAMPLES: string[] = [
  `VITE_SUPABASE_PUBLISHABLE_KEY="${"sb_" + "publishable_" + F(30)}"`,
  `VITE_SUPABASE_ANON_KEY=${jwt({ iss: "supabase", ref: "fakefakefakefakefake", role: "anon", iat: 1, exp: 2 })}`,
  `VITE_SUPABASE_ANON_KEY=${jwt({ role: "anon", iss: "supabase" })}`,
  `VITE_APPLE_MAPKIT_TOKEN=${jwt({ iss: "P85MCK558V", iat: 1, exp: 2 })}`,
  "STRIPE_SECRET_KEY=" + "sk_" + "live_" + "x".repeat(24),
  '.replace(/-----BEGIN PRIVATE KEY-----/g, "")',
  "const store_backup_abcdefghijklmnopqrstu = 1;",
  'curl -u "$STRIPE_SECRET_KEY:" https://api.stripe.com',
];

const ids = (text: string) => scanText(text).map((f: { id: string }) => f.id);

describe("Q75 secret-scan gate", () => {
  it("the shape inventory is real, and every shape has a planted fake", () => {
    expect(SECRET_SHAPES.length).toBeGreaterThan(10);
    expect(SECRET_SHAPES.map((s: { id: string }) => s.id).sort()).toEqual(Object.keys(FAKES).sort());
  });

  it.each(Object.entries(FAKES))("%s catches a planted fake", (id, value) => {
    expect(ids(`const x = "${value}";`)).toContain(id);
  });

  it.each(MORE_FAKES)("%s catches variant #%#", (id, value) => {
    expect(ids(value)).toContain(id);
  });

  it.each(ALLOWED_SAMPLES.map((s, i) => [i, s]))("allowed sample #%s is not flagged", (_i, sample) => {
    expect(ids(sample as string)).toEqual([]);
  });

  it(".gitleaks.toml carries the same rules and allowlist as the node scanner", () => {
    const toml = read(".gitleaks.toml");
    expect(toml).toMatch(/\[extend\]\s*\nuseDefault = true/);
    const rules = [...toml.matchAll(/\[\[rules\]\]\nid = "([^"]+)"\n[^\n]*\nregex = '''(.*)'''/g)].map((m) => [m[1], m[2]]);
    expect(rules.length).toBeGreaterThan(10);
    expect(rules).toEqual(SECRET_SHAPES.map((s: { id: string; regex: string }) => [s.id, s.regex]));
    for (const r of [...ALLOWED_MATCHES, ...ALLOWED_LINES]) expect(toml).toContain(`'''${r}'''`);
  });

  it("every allowlist entry still matches something in the repo (two-way)", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
    const texts: string[] = [];
    for (const f of files) {
      let t: string;
      try {
        t = read(f);
      } catch {
        continue;
      }
      if (t.length < 2_000_000 && !t.includes("\u0000")) texts.push(t);
    }
    expect(texts.length).toBeGreaterThan(1000);
    const staleAllow = [...ALLOWED_MATCHES, ...ALLOWED_LINES].filter((r: string) => !texts.some((t) => new RegExp(r).test(t)));
    expect(staleAllow.map((r: string) => `stale baseline entry ${r} — remove it (lower the baseline)`)).toEqual([]);
  });

  it(".gitleaksignore holds fingerprints and comments only, never a value", () => {
    const lines = read(".gitleaksignore").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines.length).toBeGreaterThan(10);
    const FP = /^[0-9a-f]{40}:[\w./@-]+:[\w-]+:\d+$/;
    expect(lines.filter((l) => !FP.test(l))).toEqual([]);
  });

  it("the pre-commit hook runs the staged scan", () => {
    expect(read(".husky/pre-commit")).toMatch(/^node scripts\/secret-scan\.mjs --staged/m);
  });

  it("CI scans every push and PR with both engines, redacted, and fails on a finding", () => {
    const wf = read(".github/workflows/secret-scan.yml");
    expect(wf).toMatch(/^on:\n(?:\s*#.*\n)*\s+push:\s*\n\s+pull_request:/m);
    expect(wf).toMatch(/gitleaks git [^\n]*--config \.gitleaks\.toml[^\n]*--redact[^\n]*--exit-code 1/);
    expect(wf).toContain('node scripts/secret-scan.mjs --range "${RANGE}"');
    expect(wf).toMatch(/sha256sum -c/);
    expect(wf).toContain("node scripts/check-gitleaksignore.mjs");
    expect(wf).not.toMatch(/continue-on-error|\|\| true/);
  });

  it("the CLI exits 1 on planted fakes and never prints a value", () => {
    const dir = mkdtempSync(join(tmpdir(), "lh-secret-scan-"));
    try {
      const file = join(dir, "planted.env");
      const values = [...Object.values(FAKES), ...MORE_FAKES.map(([, v]) => v)];
      writeFileSync(file, values.map((v, i) => `K${i}="${v}"`).join("\n") + "\n");
      let out = "";
      let status = 0;
      try {
        execFileSync("node", ["scripts/secret-scan.mjs", "--files", file], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        const err = e as { status: number; stdout: string; stderr: string };
        status = err.status;
        out = err.stdout + err.stderr;
      }
      expect(status).toBe(1);
      for (const id of Object.keys(FAKES)) expect(out).toContain(`SECRET-SCAN ${id}`);
      for (const v of values) for (const piece of v.split(/[\n.]/).filter((p) => p.length >= 16)) expect(out).not.toContain(piece);

      writeFileSync(file, ALLOWED_SAMPLES.join("\n") + "\n");
      expect(execFileSync("node", ["scripts/secret-scan.mjs", "--files", file], { cwd: ROOT, encoding: "utf8" })).toContain("clean");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
