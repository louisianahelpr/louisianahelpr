/**
 * GUARD (docs/OPEN.md Q62): things that die silently on a date.
 *
 * The expiry monitor (scripts/expiry-check.mjs, daily in
 * .github/workflows/expiry-monitor.yml) is only worth having if three things
 * hold, and each is proved here against the real script and the real tree:
 *
 *   (a) a date inside the warn window (30 days) FAILS the run — through the
 *       CLI the workflow actually runs, not just the helper;
 *   (b) an item it cannot read is REPORTED as UNREADABLE (its own line, its
 *       own count in the summary), never skipped or folded into OK; and in
 *       --ci mode an item the inventory says CI can read fails the run when
 *       it comes back unreadable (the monitor went blind);
 *   (c) scripts/audit/expiry-inventory.json is EXACT two-way against what the
 *       repo references: every secret/env name in workflows, edge functions
 *       and .env.example is classified once (a dated item or `undated` with a
 *       reason), nothing classified is unreferenced, and every
 *       *.louisianahelpr.com host the shipped surface names has a TLS item.
 */
// @mutate scripts/lib/expiryMonitor.mjs | return { status: daysLeft <= warnDays ? "DUE" : "OK", daysLeft }; | return { status: "OK", daysLeft };
// @mutate scripts/lib/expiryMonitor.mjs | if (!reading.expiresAt) return { ...base, status: "UNREADABLE", | if (!reading.expiresAt) return { ...base, status: "OK",
// @mutate scripts/lib/expiryMonitor.mjs | const blind = ci ? unreadable.filter((r) => r.ciReadable) : []; | const blind = [];
// @mutate scripts/expiry-check.mjs | for (const r of v.unreadable) { | for (const r of []) {
// @mutate scripts/lib/expiryMonitor.mjs | const SB_STATUS = { OK: "PASS", DUE: "FAIL", EXPIRED: "FAIL", NO_EXPIRY: "INFO", UNREADABLE: "UNKNOWN" }; | const SB_STATUS = { OK: "PASS", DUE: "PASS", EXPIRED: "FAIL", NO_EXPIRY: "INFO", UNREADABLE: "PASS" };
// @mutate scripts/audit/expiry-inventory.json |     "CRON_SECRET": "self-generated shared secret",\n |
// @mutate scripts/audit/expiry-inventory.json | "APP_URL": "config, not a credential", | "APP_URL": "config, not a credential", "LH_NEVER_REFERENCED": "stale",
// @mutate scripts/lib/expiryMonitor.mjs | if (read.date) return { expiresAt: read.date, | if (false) return { expiresAt: read.date,
// @mutate scripts/audit/expiry-inventory.json | "read": { "method": "tls", "host": "louisianahelpr.com" } | "read": { "method": "tls", "host": "old.louisianahelpr.com" }
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classify,
  evaluate,
  inventoryDiff,
  jwtExp,
  loadInventory,
  readItem,
  readTls,
  scoreboardRows,
  referencedHosts,
  referencedNames,
  verdict,
  type InventoryItem,
} from "../../scripts/lib/expiryMonitor.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const NOW = new Date("2026-09-23T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString();

const manual = (id: string, date: string | null, ciReadable = false): InventoryItem => ({
  id, label: `fixture ${id}`, env: [], hosts: [], sourceOfTruth: "fixture", ciReadable,
  read: { method: "manual", date, recorded: "2026-09-23" },
});

/** Run the real CLI against a fixture inventory. */
function cli(items: InventoryItem[], extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "expiry-"));
  const inv = join(dir, "inv.json");
  writeFileSync(inv, JSON.stringify({ warnDays: 30, items, undated: {} }));
  const env = { ...process.env, EXPIRY_REPORT: join(dir, "report.md"), GITHUB_ACTIONS: "", GITHUB_OUTPUT: "" };
  try {
    const out = execFileSync("node", ["scripts/expiry-check.mjs", "--inventory", inv, ...extra], { cwd: ROOT, env, encoding: "utf8" });
    return { code: 0, out, report: readFileSync(env.EXPIRY_REPORT, "utf8") };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, out: err.stdout, report: readFileSync(env.EXPIRY_REPORT, "utf8") };
  }
}

describe("(a) a date inside the warn window fails", () => {
  it("classify: 10 days out is DUE, exactly 30 is DUE, 31 is OK, yesterday is EXPIRED", () => {
    expect(classify(inDays(10), NOW, 30).status).toBe("DUE");
    expect(classify(inDays(30), NOW, 30).status).toBe("DUE");
    expect(classify(inDays(31.5), NOW, 30).status).toBe("OK");
    expect(classify(inDays(-1), NOW, 30).status).toBe("EXPIRED");
  });

  it("the CLI exits 1 and names the item when one expires in 10 days", () => {
    const soon = inDays(10).slice(0, 10);
    const r = cli([manual("soon", soon), manual("later", "2099-01-01")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^DUE\s+fixture soon/m);
    expect(r.out).toMatch(/ERROR fixture soon expires/);
    expect(r.report).toMatch(/fixture soon \| DUE/);
  });

  it("the CLI exits 0 when everything is more than 30 days out", () => {
    const r = cli([manual("later", "2099-01-01")]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 items: 1 OK/);
  });
});

describe("(b) an unreadable item is reported, never skipped", () => {
  it("evaluate: no expiry read is UNREADABLE, not OK", () => {
    const res = evaluate(manual("x", null), { expiresAt: null, detail: "unreadable here: no secret" }, NOW, 30);
    expect(res.status).toBe("UNREADABLE");
    const v = verdict([res]);
    expect(v.unreadable).toHaveLength(1);
    expect(v.summary).toBe("1 items: 1 UNREADABLE");
  });

  it("the CLI prints an UNREADABLE line and counts it in the summary", () => {
    const r = cli([manual("blank", null), manual("later", "2099-01-01")]);
    expect(r.out).toMatch(/^UNREADABLE\s+fixture blank/m);
    expect(r.out).toMatch(/WARNING UNREADABLE here: fixture blank/);
    expect(r.out).toMatch(/2 items: 1 UNREADABLE, 1 OK/);
    expect(r.report).toMatch(/fixture blank \| UNREADABLE/);
  });

  it("--ci fails when an item the inventory says CI can read is unreadable", () => {
    expect(cli([manual("blind", null, true)]).code).toBe(0);
    const r = cli([manual("blind", null, true)], ["--ci"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ERROR UNREADABLE here: fixture blind .*the inventory says CI can read this/);
  });

  it("the scoreboard shows DUE as FAIL and UNREADABLE as UNKNOWN with its reason, never PASS", () => {
    const rows = scoreboardRows([
      evaluate(manual("soon", inDays(10)), { expiresAt: inDays(10), detail: "d" }, NOW, 30),
      evaluate(manual("blank", null), { expiresAt: null, detail: "unreadable here: no secret" }, NOW, 30),
    ], "2026-09-23T12:00Z");
    expect(rows.map((r) => r.status)).toEqual(["FAIL", "UNKNOWN"]);
    expect(rows[1].note).toMatch(/^UNKNOWN: unreadable here: no secret/);
  });

  it("a TLS certificate the public roots do not trust (an intercepting proxy) is UNREADABLE, not its date", async () => {
    const fake = (_o: unknown, cb: () => void) => {
      const s = {
        authorized: false, authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        getPeerCertificate: () => ({ valid_to: "Dec 31 00:00:00 2099 GMT", issuer: { O: "Proxy", CN: "MITM" }, subject: { CN: "x" } }),
        on: () => s, destroy: () => {},
      };
      setTimeout(cb, 0);
      return s;
    };
    const r = await readTls("www.louisianahelpr.com", { connect: fake });
    expect(r.expiresAt).toBeNull();
    expect(r.detail).toMatch(/not trusted by the public roots/);
  });
});

describe("Sign in with Apple: the API masks the secret, so its date is recorded", () => {
  // Measured 2026-09-24: GET /config/auth returns a 64-hex hash for
  // external_apple_secret, never the JWT, so its exp is unreadable by API.
  const masked = (async () => new Response(JSON.stringify({ external_apple_enabled: true, external_apple_secret: "f".repeat(64) }), { status: 200 })) as unknown as typeof fetch;
  const env = { SUPABASE_ACCESS_TOKEN: "t", SUPABASE_PROJECT_REF: "r" };
  const item = (date: string | null): InventoryItem => ({
    id: "apple", label: "apple", env: [], hosts: [], sourceOfTruth: "fixture", ciReadable: false,
    read: { method: "supabase-auth-apple", date, recorded: date ? "2026-09-24" : null },
  } as unknown as InventoryItem);
  it("a masked secret with no recorded date is UNREADABLE", async () => {
    const r = await readItem(item(null), { env, fetchFn: masked });
    expect(r.expiresAt).toBeNull();
    expect(r.detail).toMatch(/masks external_apple_secret/);
  });
  it("a masked secret uses the owner's recorded date", async () => {
    const r = await readItem(item("2027-01-01T00:00:00Z"), { env, fetchFn: masked });
    expect(r.expiresAt).toBe("2027-01-01T00:00:00Z");
  });
  it("the live inventory does not claim CI can read it", () => {
    const apple = loadInventory(ROOT).items.find((i: InventoryItem) => i.id === "apple-signin-web-secret");
    expect(apple?.ciReadable).toBe(false);
  });
});

describe("(c) the inventory is exact two-way against the repo", () => {
  const inv = loadInventory(ROOT);
  const names = referencedNames(ROOT, blankComments);
  const hosts = referencedHosts(ROOT);

  it("the inventories are real (floors)", () => {
    expect(names.size).toBeGreaterThan(60);
    expect(inv.items.length).toBeGreaterThan(20);
    expect(hosts.size).toBeGreaterThanOrEqual(2);
    expect(inv.items.filter((i) => i.read.method === "tls").length).toBeGreaterThanOrEqual(2);
  });

  it("no referenced name is unclassified, none classified twice, none classified but unreferenced", () => {
    const d = inventoryDiff(inv, names, hosts, ROOT);
    expect(d.unclassified, `referenced but not in scripts/audit/expiry-inventory.json (add to an item's env or to undated with a reason): ${d.unclassified.map((n) => `${n} <- ${names.get(n)?.join(", ")}`).join("; ")}`).toEqual([]);
    expect(d.duplicated).toEqual([]);
    expect(d.unreferenced, "in the inventory but no longer referenced anywhere — remove it").toEqual([]);
    expect(d.missingLiteral).toEqual([]);
  });

  it("every *.louisianahelpr.com host the shipped surface names has a TLS item, and every TLS item is named", () => {
    const d = inventoryDiff(inv, names, hosts, ROOT);
    expect(d.hostsWithoutTls, `hosts with no TLS item: ${d.hostsWithoutTls.map((h) => `${h} <- ${hosts.get(h)?.slice(0, 3).join(", ")}`).join("; ")}`).toEqual([]);
    expect(d.tlsWithoutReference).toEqual([]);
  });

  it("every item names a read method the monitor implements and a source of truth", () => {
    const methods = new Set(["tls", "rdap", "jwt-exp", "x509-p12", "x509-pem", "asc-api", "vercel-token", "meta-debug-token", "supabase-auth-apple", "no-expiry", "manual"]);
    for (const i of inv.items) {
      expect(methods.has(i.read.method), `${i.id}: ${i.read.method}`).toBe(true);
      expect(i.sourceOfTruth.length, i.id).toBeGreaterThan(10);
    }
  });

  it("the MapKit token in .env.example is read from its JWT exp (2027-02-14)", () => {
    const tok = /^VITE_APPLE_MAPKIT_TOKEN="([^"]+)"/m.exec(readFileSync(join(ROOT, ".env.example"), "utf8"))?.[1];
    expect(jwtExp(tok)?.slice(0, 10)).toBe("2027-02-14");
  });
});
