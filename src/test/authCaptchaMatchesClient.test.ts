/*
 * OPEN.md "auth-captcha-matches-client": Supabase Auth's captcha switch must agree with
 * the deployed web build, and captcha refusals from several networks alert.
 *
 * On 2026-10-15 66 password sign-ins answered captcha_failed and were read as
 * an outage; every one came from ONE address (this Mac: sec-a's 60-try probe,
 * a node script, the lead's browser tests). Nothing checked the two switches
 * (Supabase Auth security_captcha_enabled, Vercel VITE_TURNSTILE_ENABLED)
 * against each other, and nothing told our probes from people.
 *
 * Live halves: scripts/check-auth-captcha-matches-client.mjs and
 * scripts/check-captcha-refusals.mjs, both hourly in prod-errors.yml. Here: the verdicts, both scripts end to end against
 * a loopback stub (planted mismatch red, match green, a burst red, our own
 * single-address probe quiet), and the workflow wiring.
 */
// @mutate scripts/lib/authCaptcha.mjs | if (server && !client) { | if (false) {
// @mutate scripts/lib/authCaptcha.mjs | if (!server && client) { | if (false) {
// @mutate scripts/lib/authCaptcha.mjs | return { fire: addrs.size >= minAddresses, | return { fire: refusals >= minAddresses,
// @mutate scripts/check-auth-captcha-matches-client.mjs | if (text.includes(TURNSTILE_LOADER)) { | if (true) {
// @mutate scripts/check-captcha-refusals.mjs | const MIN_ADDRESSES = 2; | const MIN_ADDRESSES = 99;
// @mutate .github/workflows/prod-errors.yml | run: node scripts/check-captcha-refusals.mjs | run: "true"
// @mutate .github/workflows/prod-errors.yml | run: node scripts/check-auth-captcha-matches-client.mjs | run: "true"
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { captchaVerdict, refusalVerdict, referencedChunks, siteKeysIn } from "../../scripts/lib/authCaptcha.mjs";

const ROOT = resolve(__dirname, "..", "..");
const KEY = "0x4AAAAAAFOBRZ7o_J6I6kF8";

// The shape the live loader chunk had on 2026-10-15 (app-shared-B9FOns9o.js,
// minified by the production build) and the same chunk with Turnstile off: a
// vite build of src/lib/turnstile.ts without VITE_TURNSTILE_ENABLED drops the
// key literal (measured: ON keys=[KEY], OFF keys=[]; loader present in both).
const LOADER_ON = `var nb=\`${KEY}\`,rb=\`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit\`;function ib(){return nb}`;
const LOADER_OFF = "var rb=`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`;function ib(){return null}";

describe("captchaVerdict", () => {
  const on = { security_captcha_enabled: true, security_captcha_provider: "turnstile" };
  const off = { security_captcha_enabled: false, security_captcha_provider: "turnstile" };
  it("agrees: ON + key, OFF + no key", () => {
    expect(captchaVerdict(on, [KEY]).ok).toBe(true);
    expect(captchaVerdict(off, []).ok).toBe(true);
  });
  it("disagrees either way, and on a provider the client does not speak", () => {
    expect(captchaVerdict(on, [])).toMatchObject({ ok: false, detail: expect.stringMatching(/sends NO Turnstile token/) });
    expect(captchaVerdict(off, [KEY])).toMatchObject({ ok: false, detail: expect.stringMatching(/captcha is OFF/) });
    expect(captchaVerdict({ ...on, security_captcha_provider: "hcaptcha" }, [KEY]).ok).toBe(false);
  });
  it("refuses to judge a config without the switch", () => {
    expect(() => captchaVerdict({}, [KEY])).toThrow(/security_captcha_enabled/);
    expect(() => captchaVerdict([], [KEY])).toThrow(/config object/);
  });
});

describe("siteKeysIn / referencedChunks", () => {
  it("reads the key only from the ON build", () => {
    expect(siteKeysIn(LOADER_ON)).toEqual([KEY]);
    expect(siteKeysIn(LOADER_OFF)).toEqual([]);
  });
  it("finds the chunks a page and an entry reference", () => {
    expect(referencedChunks('<script type="module" src="/assets/index-DuBjCNIv.js"></script><link rel="modulepreload" href="/assets/preload-helper-BLdHbfdN.js">')).toEqual([
      "assets/index-DuBjCNIv.js",
      "assets/preload-helper-BLdHbfdN.js",
    ]);
    expect(referencedChunks('import("./assets/app-shared-B9FOns9o.js");m("assets/app-shared-B9FOns9o.js")')).toEqual(["assets/app-shared-B9FOns9o.js"]);
  });
});

describe("refusalVerdict", () => {
  it("our own probe (one address, 66 refusals, the 2026-10-15 false alarm) stays quiet", () => {
    expect(refusalVerdict([{ remote_addr: "35.131.106.242", n: 66 }], 2)).toEqual({ fire: false, refusals: 66, addresses: 1 });
  });
  it("two networks fire", () => {
    expect(refusalVerdict([{ remote_addr: "1.1.1.1", n: 1 }, { remote_addr: "2.2.2.2", n: 1 }], 2).fire).toBe(true);
  });
  it("a malformed row is not quiet", () => {
    expect(() => refusalVerdict([{ n: 3 }], 2)).toThrow(/remote_addr/);
    expect(() => refusalVerdict({}, 2)).toThrow(/row list/);
  });
});

// ── both scripts end to end against a loopback stub ────────────────────────
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    const [, mode] = url.split("/");
    res.setHeader("Content-Type", "application/json");
    if (url.endsWith("/config/auth")) {
      return void res.end(JSON.stringify({ security_captcha_enabled: mode !== "srvoff", security_captcha_provider: "turnstile" }));
    }
    if (url.includes("/analytics/endpoints/logs")) {
      const sql = decodeURIComponent(url);
      if (sql.includes("select count() as n")) return void res.end(JSON.stringify({ result: [{ n: 6599 }] }));
      const rows = mode === "burst" ? [{ remote_addr: "1.1.1.1", n: 3 }, { remote_addr: "2.2.2.2", n: 1 }] : [{ remote_addr: "35.131.106.242", n: 66 }];
      return void res.end(JSON.stringify({ result: rows }));
    }
    res.setHeader("Content-Type", "text/html");
    if (url.endsWith(`/${mode}/`)) return void res.end('<script type="module" src="/assets/index-a.js"></script>');
    if (url.endsWith("/assets/index-a.js")) return void res.end('import("./assets/app-shared-b.js")');
    if (url.endsWith("/assets/app-shared-b.js")) return void res.end(mode === "weboff" ? LOADER_OFF : LOADER_ON);
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(script: string, mode: string): Promise<{ code: number; out: string }> {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SUPABASE_ACCESS_TOKEN: "stub",
    SUPABASE_PROJECT_REF: "stub",
    LH_SUPABASE_API_BASE: `${base}/${mode}`,
    LH_WEB_BASE: `${base}/${mode}`,
  };
  return new Promise((done) =>
    execFile(process.execPath, [script], { cwd: ROOT, env, timeout: 30_000 }, (err, stdout, stderr) =>
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` }),
    ),
  );
}

describe("check-auth-captcha-matches-client.mjs", () => {
  it("green when captcha is ON and the web build ships the key", async () => {
    const r = await run("scripts/check-auth-captcha-matches-client.mjs", "match");
    expect(r.out).toMatch(/OK: captcha ON \(turnstile\) and the web build sends tokens/);
    expect(r.code).toBe(0);
  });
  it("red on a planted mismatch: captcha ON, web build without the key", async () => {
    const r = await run("scripts/check-auth-captcha-matches-client.mjs", "weboff");
    expect(r.out).toMatch(/FAIL Supabase Auth captcha is ON but the deployed web build sends NO Turnstile token/);
    expect(r.code).toBe(1);
  });
  it("red the other way: captcha OFF, web build with the key", async () => {
    const r = await run("scripts/check-auth-captcha-matches-client.mjs", "srvoff");
    expect(r.out).toMatch(/FAIL the deployed web build ships Turnstile site key/);
    expect(r.code).toBe(1);
  });
});

describe("check-captcha-refusals.mjs", () => {
  it("quiet on our own one-address probe", async () => {
    const r = await run("scripts/check-captcha-refusals.mjs", "probe");
    expect(r.out).toMatch(/captcha_failed in the last 65 min: 66 from 1 address/);
    expect(r.code).toBe(0);
  });
  it("fires on refusals from two networks, without calling it an outage", async () => {
    const r = await run("scripts/check-captcha-refusals.mjs", "burst");
    expect(r.out).toMatch(/4 email sign-in\/sign-up\/reset call\(s\) were refused for captcha from 2 different networks/);
    expect(r.out).not.toMatch(/outage/i);
    expect(r.code).toBe(1);
  });
});

describe("the checks are wired", () => {
  const steps = (wf: string, job: string) => {
    const doc = parse(readFileSync(join(ROOT, ".github/workflows", wf), "utf8")) as { jobs: Record<string, { steps: { run?: string; env?: Record<string, string>; if?: string }[] }> };
    return doc.jobs[job].steps;
  };
  it("prod-errors.yml runs both hourly with the Management API token", () => {
    const s = steps("prod-errors.yml", "ledger");
    // The ledger job has 6 steps (checkout, node, db saturation, these two, sync; 2026-10-15).
    expect(s.length).toBeGreaterThan(4);
    for (const script of ["check-auth-captcha-matches-client.mjs", "check-captcha-refusals.mjs"]) {
      const step = s.find((x) => x.run === `node scripts/${script}`);
      expect(step, script).toBeDefined();
      expect(step?.env?.SUPABASE_ACCESS_TOKEN).toBe("${{ secrets.SUPABASE_ACCESS_TOKEN }}");
      expect(step?.if).toBe("always()");
    }
  });
});
