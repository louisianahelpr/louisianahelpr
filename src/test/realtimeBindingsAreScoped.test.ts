/**
 * EVERY `postgres_changes` BINDING IS SERVER-SIDE SCOPED, AND ITS CHANNEL NAME IS UNIQUE.
 *
 * CLAUDE.md: *"Realtime: every `postgres_changes` channel needs a server-side
 * user-scoped `filter` and a unique name via `channelNonce()`."* Nothing in the
 * repo enforced it until 2026-09-21 — found while proving `realtimePublication`
 * able to fail, which checks publication MEMBERSHIP only.
 *
 * WHAT AN UNFILTERED BINDING COSTS. Without `filter:`, Supabase fans every row
 * change on that table out to every subscribed client. On `notifications` or
 * `messages` that is one user's rows arriving in another user's browser — the
 * comment at NotificationPanel.tsx:300 says exactly this ("avoids receiving
 * every platform-wide notification INSERT") — plus egress on every write for
 * every connected client.
 *
 * WHAT A DUPLICATED CHANNEL NAME COSTS. Two components on one name share a
 * socket topic; the second `subscribe()` can be rejected or silently take the
 * first's callbacks, which is why `channelNonce()` exists.
 *
 * ── THE FALSE POSITIVE THIS FILE WAS BUILT AROUND ─────────────────────────
 * The first scan reported one offender, `src/lib/realtimeRecovery.ts:188` —
 * which is the ``` ``` example inside `subscribeWithRecovery`'s doc comment.
 * Every real binding was already compliant. That is the mirror image of the
 * shape that made nine guards hollow tonight: there, a comment SATISFIED an
 * assertion; here, a comment would have FAILED one. Comments are blanked
 * before scanning, offsets preserved so reported line numbers stay true.
 *
 * @mutate src/components/NotificationPanel.tsx | { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` } | { event: "INSERT", schema: "public", table: "notifications" }
 * @mutate src/lib/realtimeRecovery.ts | `${opts.name}#${channelNonce()}` | `${opts.name}`
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(__dirname, "../..");

/**
 * Blank comments, keeping length so line numbers survive. String-aware: a `//`
 * inside a string literal (a URL, a filter expression) is not a comment, and a
 * regex that assumed otherwise ate a live value elsewhere in this repo today.
 */
function blankComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const N = src.length;
  while (i < N) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < N && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < N && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      while (i < N && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < N) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    i++;
  }
  return out.join("");
}

const sourceFiles = (): string[] =>
  execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f));

type Binding = { file: string; line: number; table: string; filtered: boolean; event: string };

function bindings(): Binding[] {
  const found: Binding[] = [];
  for (const f of sourceFiles()) {
    const raw = readFileSync(resolve(ROOT, f), "utf8");
    const code = blankComments(raw);
    for (const m of code.matchAll(/"postgres_changes"\s*,\s*\{([^}]*)\}/g)) {
      const opts = m[1];
      found.push({
        file: f,
        line: code.slice(0, m.index).split("\n").length,
        table: /table:\s*["'`]([^"'`]+)/.exec(opts)?.[1] ?? "?",
        event: /event:\s*["'`]([^"'`]+)/.exec(opts)?.[1] ?? "?",
        filtered: /\bfilter\s*:/.test(opts),
      });
    }
  }
  return found;
}

describe("realtime bindings are scoped server-side", () => {
  it("finds the bindings at all — a broken scan must not pass vacuously", () => {
    const all = bindings();
    // 20 on 2026-09-21. A scan that finds far fewer has rotted, not improved.
    expect(all.length, "the postgres_changes scan found almost nothing").toBeGreaterThanOrEqual(15);
    expect(new Set(all.map((b) => b.table)).size, "every binding resolved to the same table — the option parse is wrong")
      .toBeGreaterThan(3);
  });

  /*
   * THE ONE EXEMPTION, and it is a RULE rather than a file allowlist.
   *
   * A DELETE payload carries only the old row's primary key under Postgres'
   * default REPLICA IDENTITY — no `receiver_id`, no `user_id`. So a scoping
   * filter on a DELETE binding can never match and would silently drop EVERY
   * delete event, which is worse than the unfiltered stream it replaced: the
   * payload is an id, and a handler can only use it to prune local state.
   *
   * Expressed as `event === "DELETE"` and not as a list of files, because a
   * list is the shape that rots — tonight an allowlist entry was found that
   * had never been required to match anything, standing open over every string
   * in src/ naming the company. The case below keeps this carve-out honest by
   * failing if it stops applying to anything.
   */
  const deleteOnlyExempt = (b: Binding) => b.event === "DELETE";

  it("the DELETE carve-out still applies to something — a stale exemption is a lie", () => {
    const exempt = bindings().filter((b) => !b.filtered && deleteOnlyExempt(b));
    expect(
      exempt.length,
      "no unfiltered DELETE binding exists any more, so this exemption excuses nothing and should " +
        "be deleted — otherwise the next person reads it as evidence the rule was considered here",
    ).toBeGreaterThan(0);
  });

  it("every binding carries a server-side filter", () => {
    const unscoped = bindings().filter((b) => !b.filtered && !deleteOnlyExempt(b));
    expect(
      unscoped.map((b) => `${b.file}:${b.line} table=${b.table}`),
      "a postgres_changes binding with no `filter:` fans EVERY row change on that table out to " +
        "every subscribed client — one user's rows arriving in another user's browser, plus egress " +
        "on every write. CLAUDE.md: every channel needs a server-side user-scoped filter.",
    ).toEqual([]);
  });

  it("the doc-comment example is NOT counted — comments are blanked, not read", () => {
    // realtimeRecovery.ts's JSDoc shows an unfiltered binding as illustration.
    // Counting it would make this guard permanently red on correct code, which
    // is how a guard gets deleted rather than fixed.
    expect(bindings().some((b) => b.file.endsWith("src/lib/realtimeRecovery.ts"))).toBe(false);
    // …and the blanker must not be a blunt instrument: a `//` inside a string
    // must survive, or real option objects get eaten.
    expect(blankComments('const u = "https://x.dev/a"; // gone')).toContain('"https://x.dev/a"');
  });

  it("the helper this guard TRUSTS for uniqueness really does add a nonce", () => {
    /*
     * The constant-name rule below exempts anything going through
     * `subscribeWithRecovery`, on the premise that it appends a fresh
     * `channelNonce()` per attempt. An exemption whose premise nobody checks is
     * how a rule quietly stops applying — so the premise is asserted here.
     *
     * This replaced a registered mutation that SURVIVED: it turned a call
     * site's `unread-sidebar-${user.id}` into a constant, which the exemption
     * correctly allows, so nothing failed. The mutation was wrong, not the
     * assertion — but the survival was the signal that this premise was
     * load-bearing and unguarded.
     */
    const helper = blankComments(readFileSync(resolve(ROOT, "src/lib/realtimeRecovery.ts"), "utf8"));
    expect(
      helper,
      "subscribeWithRecovery no longer appends channelNonce() to the base name, so every constant " +
        "name this guard waved through is now a shared socket topic",
    ).toMatch(/channelNonce\s*\(\s*\)/);
    expect(
      /\$\{\s*opts\.name\s*\}#\$\{\s*channelNonce\(\)\s*\}/.test(helper),
      "the per-subscription identity is no longer `name#nonce` — re-check what makes two mounts of " +
        "one component distinct before trusting the constant-name exemption",
    ).toBe(true);
  });

  it("every channel name is unique per subscriber, not a shared constant", () => {
    /*
     * CLAUDE.md asks for "a unique name via channelNonce()", and the reason is
     * narrower than "no two files collide": two TABS of the SAME user, or two
     * mounts of one component, take the same socket topic if the name is a
     * constant. The second subscribe can be rejected or silently inherit the
     * first's callbacks — so one tab stops updating with nothing in the console.
     *
     * This assertion started as "no two literals collide", and my own
     * registered mutation SURVIVED it: making `unread-sidebar-${user.id}` into
     * a bare `unread-sidebar` created no duplicate, so nothing failed. The
     * mutation was right and the assertion was too weak — which is the hollow
     * shape this whole burn-down exists to find, caught here only because
     * vacuity reports SURVIVED rather than assuming killed.
     */
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const code = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      for (const m of code.matchAll(/\bname:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
        const lit = m[1];
        const isTemplate = lit.startsWith("`");
        const interpolated = isTemplate && lit.includes("${");
        if (interpolated) continue; // per-user / per-job, which is the point
        // A constant is only a problem on a realtime channel. Require the
        // surrounding call to actually be one, so unrelated `name:` options
        // (form fields, route entries) are not swept in.
        /*
         * 4000, not 1200: `subscribeWithRecovery(` can sit a long way above its
         * `{ name: … }` option when the channel chains several `.on()` bindings
         * between them — useActivityData's core subscription spans ~1.4k chars,
         * so a 1200-char lookback missed its own helper and reported correct
         * code as a violation.
         */
        const around = code.slice(Math.max(0, m.index - 4000), m.index + 200);
        if (!/supabase\.channel\(|subscribeWithRecovery|postgres_changes/.test(around)) continue;
        /*
         * `subscribeWithRecovery` appends a fresh `channelNonce()` to the base
         * name on EVERY attempt (realtimeRecovery.ts:145), so a constant passed
         * to it is a stable BASE, not a shared topic — unless `stableName: true`
         * opts out of that. My first version flagged three of those constants as
         * violations; they are correct code, and a guard that reds on correct
         * code is one people delete rather than fix.
         *
         * So the rule is: a constant name is a defect only where nothing makes
         * it unique — a raw `supabase.channel("…")`, or `stableName: true`.
         */
        const recovered = /subscribeWithRecovery/.test(around);
        const optedOutOfNonce = /stableName\s*:\s*true/.test(around);
        if (recovered && !optedOutOfNonce) continue;
        if (/channelNonce\s*\(/.test(around)) continue; // nonce applied by hand
        offenders.push(`${f}:${code.slice(0, m.index).split("\n").length} name=${lit}`);
      }
    }
    expect(
      offenders,
      "a realtime channel name that is a CONSTANT is shared by every subscriber — two tabs of the " +
        "same user take one socket topic, and the second subscribe can inherit the first's " +
        "callbacks, so one tab goes quiet with nothing in the console. Interpolate the user/job id " +
        "or use channelNonce().",
    ).toEqual([]);
  });
});
