/**
 * THE PROD A11Y SWEEP CANNOT WRITE PROD (lead, 10-31).
 *
 * `npm run check:changed` runs the a11y-prod Playwright project from the
 * pre-push hook on every builder push, signed in as the shared test accounts
 * against PROD Supabase. Its specs only look at screens, but nothing stopped
 * the app's own boot-time writes (login_history on sign-in), a volatile RPC
 * or an edge function that sends email or a notice. Service workers were
 * blocked; writes were not. e2e/a11y-prod/abortProdWrites.ts now aborts, and
 * logs, every request that could write.
 *
 * The class, from the repo's own inventory: every browser context any spec
 * under e2e/a11y-prod creates goes through abortProdWrites (and no spec uses
 * Playwright's own unrouted `page`/`context` fixture), and the RPC allow-list
 * holds only functions whose NEWEST definition is STABLE or IMMUTABLE.
 * On 10-31 the derivation matched prod's pg_proc.provolatile for all 1439
 * functions the migrations define (0 allowed that prod has VOLATILE).
 *
 * @mutate e2e/a11y-prod/a11y-prod.spec.ts | await abortProdWrites(ctx, SUPABASE_URL, OUTPUT_DIR); |
 * @mutate e2e/a11y-prod/readOnlyRpcs.ts | return m ? (m[1].toLowerCase() as Volatility) : "volatile"; | return m ? (m[1].toLowerCase() as Volatility) : "stable";
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { READ_ONLY_FUNCTIONS, writeVerdict } from "../../e2e/a11y-prod/abortProdWrites";
import { readOnlyRpcNames, rpcVolatility, volatilityOf } from "../../e2e/a11y-prod/readOnlyRpcs";

const DIR = join(process.cwd(), "e2e", "a11y-prod");
const specs = readdirSync(DIR).filter((f) => f.endsWith(".spec.ts"));
const code = (f: string) => blankComments(readFileSync(join(DIR, f), "utf8"));

describe("every a11y-prod browser context aborts prod writes", () => {
  it("finds the specs and their contexts (inventory floor)", () => {
    expect(specs.length).toBeGreaterThan(2);
    const contexts = specs.reduce((n, f) => n + (code(f).match(/\.newContext\s*\(/g) ?? []).length, 0);
    expect(contexts).toBeGreaterThan(2);
  });

  it.each(specs)("%s: each newContext is followed by abortProdWrites on that context", (f) => {
    const src = code(f);
    const made = [...src.matchAll(/const\s+(\w+)\s*=\s*await\s+\w+\.newContext\s*\(/g)];
    const bare = (src.match(/\.newContext\s*\(/g) ?? []).length;
    expect(made.length, `${f}: a newContext whose result is not held in a const cannot be routed`).toBe(bare);
    for (const m of made) {
      const after = src.slice(m.index!, m.index! + 600);
      expect(after, `${f}: context ${m[1]} is used before abortProdWrites(${m[1]}, ...)`).toMatch(
        new RegExp(`await\\s+abortProdWrites\\(\\s*${m[1]}\\s*,`),
      );
    }
  });

  it.each(specs)("%s: never uses Playwright's own (unrouted) page or context fixture", (f) => {
    expect(code(f)).not.toMatch(/async\s*\(\s*\{[^}]*\b(page|context)\b[^}]*\}/);
  });
});

describe("writeVerdict lets through only what cannot write", () => {
  const rpcs = new Set(["get_reads_only"]);
  it.each([
    ["GET", "/rest/v1/jobs?select=id"],
    ["HEAD", "/rest/v1/jobs"],
    ["GET", "/storage/v1/object/public/a/b.png"],
    ["POST", "/auth/v1/token?grant_type=refresh_token"],
    ["POST", "/rest/v1/rpc/get_reads_only"],
  ])("allows %s %s", (m, p) => expect(writeVerdict(m, p, rpcs)).toBeNull());
  it.each([
    ["POST", "/rest/v1/login_history"], // the boot-time write measured on 10-31
    ["PATCH", "/rest/v1/profiles?id=eq.x"],
    ["DELETE", "/rest/v1/notifications?id=eq.x"],
    ["PUT", "/rest/v1/saved_searches"],
    ["POST", "/rest/v1/rpc/mark_everything_read"],
    ["POST", "/storage/v1/object/avatars/x.png"],
    ["PUT", "/auth/v1/user"],
    ["POST", "/auth/v1/logout"],
    ["POST", "/graphql/v1"],
    ["GET", "/functions/v1/send-email"],
    ["POST", "/functions/v1/notify"],
  ])("aborts %s %s", (m, p) => expect(writeVerdict(m, p, rpcs)).not.toBeNull());
  it("keeps the edge-function allow-list short and named", () => {
    expect(READ_ONLY_FUNCTIONS.size).toBeLessThan(6);
  });
});

describe("the RPC allow-list is the STABLE/IMMUTABLE set, from the newest definition", () => {
  const tmp = mkdtempSync(join(tmpdir(), "rpcvol-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const write = (name: string, sql: string) => writeFileSync(join(tmp, name), sql);
  write(
    "20260101000000_a.sql",
    `create function public.was_stable() returns int language sql stable as $$ select 1 $$;
     create function public.reads() returns int language plpgsql stable as $fn$ begin return 1; end $fn$;
     create function public.pure(x int) returns int language sql immutable as $body$ select x $body$;
     create function public.says_stable() returns void language plpgsql as $$ begin -- stable order
       perform 'immutable'; insert into t values (1); end $$;
     create function public.dropped() returns int language sql stable as $$ select 1 $$;`,
  );
  write(
    "20260102000000_b.sql",
    `create or replace function public.was_stable() returns int language plpgsql as $$ begin insert into t values (1); return 1; end $$;
     drop function if exists public.dropped();`,
  );

  it("drops a function redefined VOLATILE, keeps STABLE/IMMUTABLE, ignores words in the body", () => {
    expect([...readOnlyRpcNames(tmp)].sort()).toEqual(["pure", "reads"]);
    expect(rpcVolatility(tmp).get("was_stable")).toBe("volatile");
    expect(rpcVolatility(tmp).get("says_stable")).toBe("volatile");
  });

  it("reads VOLATILE when no keyword is given (Postgres's default)", () => {
    expect(volatilityOf("create function f() returns int language sql as $$ select 1 $$;")).toBe("volatile");
  });

  it("the real tree: a floor of read-only RPCs, and none of them redefined VOLATILE", () => {
    const vol = rpcVolatility();
    const ro = readOnlyRpcNames();
    expect(ro.size).toBeGreaterThan(400);
    for (const n of ro) expect(vol.get(n), n).not.toBe("volatile");
  });

  it("no migration changes volatility with ALTER FUNCTION (the parser reads only CREATE)", () => {
    const mig = join(process.cwd(), "supabase", "migrations");
    const hits = readdirSync(mig)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /alter\s+function[^;]*\b(stable|immutable|volatile)\b/i.test(blankSqlComments(readFileSync(join(mig, f), "utf8"))));
    expect(hits).toEqual([]);
  });
});
