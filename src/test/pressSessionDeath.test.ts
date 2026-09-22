import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE CLASS: the press sweep pressing on with a token GoTrue no longer accepts,
 * and reporting the wreckage as product defects.
 *
 * Run 35761400822 failed with 274 "failed presses" across four shards
 * (66/56/90/62). Shard 3's reasons were 39×`403 GET v1/user`, 38×500, 21×401,
 * 5 "no observable change" and 1 NOT CLICKABLE — zero "control not found".
 * GoTrue's own logs for the window answered `session_not_found` ("the session
 * ROW is gone, not merely expired") 183 times from the four shard IPs, with
 * ZERO /logout calls: nothing signed out. The harness mints `sessions[persona]`
 * once at run start and injects that one token into every `browser.newContext()`
 * for the whole sweep — shard 2 ran 26 minutes on it — and never asked GoTrue
 * again. Every screen after the session died measured the logged-out app and
 * was counted as a defect, masking whatever real defects the run did find.
 *
 * What is guarded here, on the source of the two harness files (they drive prod
 * and cannot be executed in a unit test):
 *   1. liveness is re-asked mid-sweep, through the ONE existing idiom
 *      (e2e/liveSession.ts via pressProdSafety), not a second hand-rolled one;
 *   2. a 401/403 row is re-verified and, if the session is gone, its failures
 *      are DISCARDED rather than counted;
 *   3. a session death is surfaced distinctly — its own ::error, its own
 *      coverage banner, its own results.json keys — and fails the run on its
 *      own, even with zero press failures;
 *   4. re-minting drops the on-disk cache first, or readLiveCache hands the
 *      dead session straight back.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const press = read("scripts/audit/press-every-control.mjs");
const safety = read("scripts/audit/pressProdSafety.mjs");

// @mutate scripts/audit/press-every-control.mjs | const session = persona === "anon" ? null : await ensureLiveSession(persona); | const session = persona === "anon" ? null : sessions[persona];
// @mutate scripts/audit/press-every-control.mjs | if (!s.suspect && Date.now() - s.at < SESSION_VERIFY_MS) return s; | return s;
// @mutate scripts/audit/press-every-control.mjs | if (session && netFails.some((f) => /^40[13] /.test(f)) && !(await sessionStillAlive(session))) { | if (false) {
// @mutate scripts/audit/press-every-control.mjs | failedPresses -= rec.failed; | void rec.failed;
// @mutate scripts/audit/press-every-control.mjs | failedPresses > 0 \|\| undocumented > 0 \|\| sessionDeaths.length > 0 | failedPresses > 0 \|\| undocumented > 0
// @mutate scripts/audit/pressProdSafety.mjs | rmSync(resolve(CACHE_DIR, `${role}.raw.json`), { force: true }); | void role;
describe("press-every-control survives a session that dies mid-sweep", () => {
  it("re-verifies the session before a row instead of trusting the run-start mint", () => {
    // The per-row session comes from the guard, never straight off the map.
    expect(press).toContain('const session = persona === "anon" ? null : await ensureLiveSession(persona);');
    expect(press).not.toMatch(/const session = persona === "anon" \? null : sessions\[persona\];/);
    // …and the guard is time-boxed, so one token is not trusted for 26 minutes.
    expect(press).toContain("const SESSION_VERIFY_MS =");
    expect(press).toContain("if (!s.suspect && Date.now() - s.at < SESSION_VERIFY_MS) return s;");
    expect(press).toContain("if (await sessionStillAlive(s)) { s.at = Date.now(); s.suspect = false; return s; }");
  });

  it("reuses the one liveness idiom rather than hand-rolling a second", () => {
    // press imports both helpers from pressProdSafety, which is itself built on
    // e2e/liveSession.ts — the single place a session is checked against GoTrue.
    expect(press).toMatch(/import \{[^}]*\bremintSession\b[^}]*\}\s*from "\.\/pressProdSafety\.mjs"/s);
    expect(press).toMatch(/import \{[^}]*\bsessionStillAlive\b[^}]*\}\s*from "\.\/pressProdSafety\.mjs"/s);
    expect(safety).toContain('from "../../e2e/liveSession.ts"');
    expect(safety).toContain("export async function sessionStillAlive(s) {");
    expect(safety).toContain("return sessionAlive(supabaseUrl(), anonKey(), s.accessToken);");
    // press must not open its own /auth/v1/user socket.
    expect(press).not.toContain("/auth/v1/user");
  });

  it("re-mints from scratch, dropping the disk cache readLiveCache would return", () => {
    expect(safety).toContain("export async function remintSession(role) {");
    expect(safety).toContain("rmSync(resolve(CACHE_DIR, `${role}.raw.json`), { force: true });");
    // The cache drop happens BEFORE the mint, or the dead session comes back.
    const body = safety.slice(safety.indexOf("export async function remintSession(role) {"));
    expect(body.indexOf("rmSync(")).toBeLessThan(body.indexOf("return prodSession(role);"));
  });

  it("does not count a row walked with a dead session as press failures", () => {
    expect(press).toContain("if (session && netFails.some((f) => /^40[13] /.test(f)) && !(await sessionStillAlive(session))) {");
    expect(press).toContain("failedPresses -= rec.failed;");
    expect(press).toContain('rec.status = "session-lost";');
    expect(press).toContain('c.result = "SESSION-LOST";');
    // The dead session is marked so the NEXT row re-mints before pressing.
    expect(press).toContain("session.suspect = true;");
  });

  it("surfaces a session death loudly and distinctly from a press failure", () => {
    // Its own annotation, not folded into the failed-press list.
    expect(press).toMatch(/::error title=press SESSION DIED::/);
    expect(press).toContain("SESSION DEATH — THIS RUN DID NOT FULLY MEASURE THE APP.");
    expect(press).toContain("are NOT product defects");
    // Machine-readable, so a later run can tell a bad night from a bad build.
    expect(press).toMatch(/sessionDeaths, sessionLostRows,/);
  });

  it("fails the run on a session death even when no press failed", () => {
    expect(press).toContain("failedPresses > 0 || undocumented > 0 || sessionDeaths.length > 0");
    expect(press).toContain("the press counts above are a floor, not a verdict.");
  });
});
