/*
 * GUARD (owner 2026-10-17 sweep spec: "how do we check everything so you don't
 * keep missing stuff"): one session lands a branch. land.sh writes a claim
 * (owner session, since, PR) to refs/lh/landing-claims on origin by
 * compare-and-swap and REFUSES a branch another session holds unless
 * --claim-override="<reason>". A missing store means no claims, and a store
 * that cannot be reached warns and carries on (no landing breaks on it).
 * Lead (2026-10-17): refs/lh/* is never a branch to report or prune.
 *
 * Red first: on origin/main 7b4eceb3f there was no claim at all (two sessions
 * could land one branch, the 10-15 20-hour idle case); each mutation below
 * removes one decision.
 */
// @mutate scripts/lib/landClaims.mjs |   if (held.owner_session === session) { |   if (true) {
// @mutate scripts/lib/landClaims.mjs |   if (String(override).trim()) { |   if (true) {
// @mutate scripts/lib/landClaims.mjs |   contenders.push({ session, at: now }); |
// @mutate scripts/lib/landClaims.mjs | `--force-with-lease=${CLAIMS_REF}:${oldSha ?? ""}`, | "--force",
// @mutate scripts/lib/landClaims.mjs |   if (!line) return { sha: null, state: emptyClaims() }; |   if (!line) throw new Error("no claims ref");
// @mutate scripts/lib/landClaims.mjs |     } catch (e) { warn("written", e); process.exit(0); } |     } catch (e) { warn("written", e); process.exit(2); }
// @mutate scripts/land.sh | node "$LAND_FROZEN_DIR/landClaims.mjs" "$CLAIM_CMD" "$CLAIM_BRANCH" ${CLAIM_ARGS[@]+"${CLAIM_ARGS[@]}"} \|\| exit 1 | true
// @mutate scripts/land.sh | case "$DRY" in 1) CLAIM_CMD=check ;; esac | true
// @mutate scripts/land.sh |   node "$LAND_FROZEN_DIR/landClaims.mjs" set-pr "$CLAIM_BRANCH" "$PR_NUM" \|\| true |   true
// @mutate scripts/land.sh |       node "$LAND_FROZEN_DIR/landClaims.mjs" release "$CLAIM_BRANCH" \|\| true |       true
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { decide, parseClaims, sessionId, resolveSession, withPr, withoutClaim, makeGit, readStore, writeStore, mutate, formatClaims, emptyClaims, CLAIMS_REF } from "../../scripts/lib/landClaims.mjs";
// @ts-expect-error — plain .mjs module, no declaration file
import { localInventory, remoteInventory, setMainRef } from "../../scripts/stranded-work.mjs";
import { buildMainIndex } from "../../scripts/lib/strandedContent.mjs";

const CLI = resolve(__dirname, "../../scripts/lib/landClaims.mjs");
const ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...ENV } });
const cli = (cwd: string, env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...ENV, CLAUDE_SESSION: "", CLAUDE_CODE_BRIDGE_SESSION_ID: "", ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

let root = "";
let origin = "";
let repo = "";
let clone = "";
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-claims-test-")));
  origin = join(root, "origin.git");
  repo = join(root, "work");
  clone = join(root, "clone");
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(root, "init", "-q", "-b", "main", repo);
  writeFileSync(join(repo, "a.ts"), "export const a = 'the only module on main';\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
  sh(repo, "remote", "add", "origin", origin);
  sh(repo, "push", "-q", "origin", "main");
  sh(repo, "fetch", "-q", "origin");
  sh(repo, "switch", "-q", "-c", "ready/x");
  sh(root, "clone", "-q", origin, clone);
});
afterAll(() => { setMainRef(null); if (root) rmSync(root, { recursive: true, force: true }); });

describe("landing claims: the decision", () => {
  const NOW = "2026-10-17T06:00:00.000Z";
  it("a free branch is claimed; the same session again keeps its since; another session is refused and recorded", () => {
    const a = decide(emptyClaims(), "ready/x", "session_A", { now: NOW });
    expect(a.verdict).toBe("claimed");
    expect(a.state.claims["ready/x"]).toMatchObject({ owner_session: "session_A", since: NOW, pr: null });
    const again = decide(a.state, "ready/x", "session_A", { now: "2026-10-17T07:00:00.000Z" });
    expect(again.verdict).toBe("renewed");
    expect(again.state.claims["ready/x"].since).toBe(NOW);
    const b = decide(a.state, "ready/x", "session_B", { now: NOW });
    expect(b.verdict).toBe("refused");
    expect(b.state.claims["ready/x"].owner_session).toBe("session_A");
    expect(b.state.claims["ready/x"].contenders).toEqual([{ session: "session_B", at: NOW }]);
  });
  it("an override needs a reason, and the reason and the previous owner are kept", () => {
    const a = decide(emptyClaims(), "ready/x", "session_A", { now: NOW }).state;
    expect(decide(a, "ready/x", "session_B", { override: "   " }).verdict).toBe("refused");
    const o = decide(a, "ready/x", "session_B", { override: "A stopped 10 h ago", now: NOW });
    expect(o.verdict).toBe("overridden");
    expect(o.state.claims["ready/x"]).toMatchObject({ owner_session: "session_B", overridden: { from: "session_A", reason: "A stopped 10 h ago" } });
  });
  it("the PR is recorded and the claim released only by its own session", () => {
    const a = decide(emptyClaims(), "ready/x", "session_A", { now: NOW }).state;
    expect(withPr(a, "ready/x", "3300", "session_B").changed).toBe(false);
    const p = withPr(a, "ready/x", "3300", "session_A");
    expect(p.state.claims["ready/x"].pr).toBe(3300);
    expect(withoutClaim(p.state, "ready/x", "session_B").changed).toBe(false);
    expect(withoutClaim(p.state, "ready/x", "session_A").state.claims).toEqual({});
  });
  it("a missing or empty file is no claims; a wrong shape is an error, never an empty list", () => {
    expect(parseClaims(null)).toEqual(emptyClaims());
    expect(parseClaims("")).toEqual(emptyClaims());
    expect(() => parseClaims('{"claims": []}')).toThrow();
    expect(() => parseClaims("{")).toThrow();
  });
  it("the owner session: $CLAUDE_SESSION, then the bridge session, then the newest Claude-Session trailer, then the worktree", () => {
    expect(sessionId("https://claude.ai/code/session_0157fqKvPZPG")).toBe("session_0157fqKvPZPG");
    expect(resolveSession({ env: { CLAUDE_SESSION: "s1", CLAUDE_CODE_BRIDGE_SESSION_ID: "session_B" }, trailers: ["session_T"] })).toBe("s1");
    expect(resolveSession({ env: { CLAUDE_CODE_BRIDGE_SESSION_ID: "session_B" }, trailers: ["session_T"] })).toBe("session_B");
    expect(resolveSession({ env: {}, trailers: ["https://claude.ai/code/session_T"] })).toBe("session_T");
    expect(resolveSession({ env: {}, trailers: [], cwd: "/w", host: "mac" })).toBe("local:mac:/w");
  });
  it("the table names owner, age, PR and every other session that tried", () => {
    const a = decide(emptyClaims(), "ready/x", "session_A", { now: NOW }).state;
    const b = decide(a, "ready/x", "session_B", { now: NOW }).state;
    const t = formatClaims(b, Date.parse("2026-10-17T18:00:00.000Z"));
    expect(t).toContain("ready/x  owner session_A");
    expect(t).toContain("(12 h)");
    expect(t).toContain("ALSO TRIED BY session_B");
    expect(formatClaims(emptyClaims())).toBe("landing claims: none");
  });
});

describe("landing claims: the store on origin (fixture repo)", () => {
  it("no ref is no claims; a write is compare-and-swap (a stale sha is refused)", () => {
    const git = makeGit(repo);
    const first = readStore(git);
    expect(first.sha).toBeNull();
    expect(first.state).toEqual(emptyClaims());
    const s1 = decide(first.state, "ready/a", "session_A").state;
    const c1 = writeStore(git, s1, null, "claim a");
    expect(sh(repo, "ls-remote", "origin", CLAIMS_REF).split(/\s+/)[0]).toBe(c1);
    // A second writer that read before c1 (sha null) loses the race.
    expect(() => writeStore(git, decide(emptyClaims(), "ready/b", "session_B").state, null, "stale")).toThrow();
    // mutate reads again and keeps both.
    mutate(git, (s: ReturnType<typeof emptyClaims>) => ({ changed: true, state: decide(s, "ready/b", "session_B").state }), "claim b");
    expect(Object.keys(readStore(git).state.claims).sort()).toEqual(["ready/a", "ready/b"]);
  });
  it("the CLI: another session is refused (exit 1), the same session renews, an override takes it, list prints the table", () => {
    const A = { CLAUDE_SESSION: "session_CA" };
    const B = { CLAUDE_SESSION: "session_CB" };
    expect(cli(repo, A, "claim", "ready/cli").code).toBe(0);
    const refused = cli(repo, B, "claim", "ready/cli");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("REFUSED");
    expect(refused.out).toContain("session_CA");
    expect(cli(repo, B, "check", "ready/cli").code).toBe(1);
    expect(cli(repo, A, "claim", "ready/cli").code).toBe(0);
    expect(cli(repo, B, "claim", "ready/cli", "--override", "").code).toBe(3);
    expect(cli(repo, B, "claim", "ready/cli", "--override", "CA stopped").code).toBe(0);
    expect(cli(repo, B, "set-pr", "ready/cli", "77").code).toBe(0);
    const list = cli(repo, {}, "list");
    expect(list.out).toContain("ready/cli  owner session_CB");
    expect(list.out).toContain("PR #77");
    expect(list.out).toContain("taken over from session_CA: CA stopped");
    expect(cli(repo, B, "release", "ready/cli").code).toBe(0);
    expect(cli(repo, {}, "list").out).not.toContain("ready/cli");
  });
  it("a store that cannot be reached warns loudly and carries on (exit 0): no landing breaks on it", () => {
    const lost = join(root, "lost");
    sh(root, "init", "-q", "-b", "main", lost);
    sh(lost, "remote", "add", "origin", join(root, "no-such-origin.git"));
    const r = cli(lost, { CLAUDE_SESSION: "session_L" }, "claim", "ready/l");
    expect(r.code).toBe(0);
    expect(r.out).toContain("WARNING");
    expect(cli(lost, { CLAUDE_SESSION: "session_L" }, "check", "ready/l").code).toBe(0);
  });
});

describe("refs/lh/* is never a branch to report or prune (lead, 2026-10-17)", () => {
  it("a clone that fetched and read the claims has no claims ref under refs/heads or refs/remotes, and stranded-work does not list it", () => {
    // Claims carry content main does not have (a JSON file), the shape a branch check would flag.
    sh(clone, "fetch", "-q", "origin");
    readStore(makeGit(clone));
    expect(sh(clone, "for-each-ref", "--format=%(refname)", CLAIMS_REF).trim()).toBe(CLAIMS_REF);
    const listed = sh(clone, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin");
    expect(listed).not.toMatch(/landing-claims/);
    const git = makeGit(clone);
    setMainRef("origin/main");
    const index = buildMainIndex(git, "origin/main");
    const gh = (_argv: string[], o?: { raw?: boolean }) => (o?.raw ? "" : []);
    const items = [...localInventory(git, index, { cwdOf: () => [] }), ...remoteInventory(git, index, gh)];
    expect(items.map((i: { id: string }) => i.id).filter((id: string) => /landing-claims|refs\/lh/.test(id))).toEqual([]);
  });
  it("land.sh wires the claim: frozen copy, claim on start (check on --dry-run), PR recorded, released when merged or closed, override parsed", () => {
    const land = readFileSync(resolve(__dirname, "../../scripts/land.sh"), "utf8");
    expect(land).toMatch(/for t in [^\n]*landClaims\.mjs[^\n]*; do/);
    const claimAt = land.indexOf('\nnode "$LAND_FROZEN_DIR/landClaims.mjs" "$CLAIM_CMD" "$CLAIM_BRANCH" ${CLAIM_ARGS[@]+"${CLAIM_ARGS[@]}"} || exit 1\n');
    expect(claimAt).toBeGreaterThan(0);
    expect(claimAt).toBeLessThan(land.indexOf("\nwhile :; do"));
    expect(land).toMatch(/\nCLAIM_CMD=claim\ncase "\$DRY" in 1\) CLAIM_CMD=check ;; esac/);
    expect(land).toMatch(/echo "land: PR #\$PR_NUM is \$BR\."\n\s+node "\$LAND_FROZEN_DIR\/landClaims\.mjs" set-pr "\$CLAIM_BRANCH" "\$PR_NUM" \|\| true/);
    expect(land).toMatch(/if \[ "\$VERDICT" = merged \] \|\| \[ "\$VERDICT" = closed \]; then\n\s+node "\$LAND_FROZEN_DIR\/landClaims\.mjs" release "\$CLAIM_BRANCH" \|\| true/);
    expect(land).toContain('--claim-override=*) CLAIM_OVERRIDE="${arg#--claim-override=}" ;;');
  });
});
