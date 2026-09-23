// @mutate scripts/audit/press-every-control.mjs |       await answerSentryLocally(ctx);\n |       void answerSentryLocally;\n
// @mutate scripts/audit/pressFailureClass.mjs | export const SENTRY_INGEST_RX = /^https:\/\/([a-z0-9-]+\.)*(ingest\.([a-z]+\.)?)?sentry\.io\//i; | export const SENTRY_INGEST_RX = /^https:\/\/sentry\.io\//i;
// @mutate .github/actions/local-preview/action.yml |         VITE_SENTRY_ENV: ci-local-preview\n | \n
// @mutate .github/actions/local-preview/action.yml |         VITE_SENTRY_ENV: ci-local-preview | VITE_SENTRY_ENV: production
// @mutate .github/workflows/press-every-control.yml |         uses: ./.github/actions/local-preview | uses: ./.github/actions/some-other-build
/*
 * GUARD (docs/OPEN.md Q296): the press sweep spends none of the PROD Sentry
 * project's quota, and its build's Sentry environment is not "production".
 *
 * Run 35837735324: six presses drew 429 on Sentry's `envelope/` — the sweep's
 * own errors, sent to the prod project (src/lib/sentry.ts has a hardcoded DSN
 * fallback, environment defaults to "production", and its beforeSend drops
 * only `localhost` while the preview is served on 127.0.0.1). A 429 there is a
 * window in which a REAL user's event can be dropped.
 *
 * Harness-side (Q275 owns src/lib/sentry.ts): every press context answers
 * Sentry ingest itself (answerSentryLocally), and the local-preview build the
 * press serves carries VITE_SENTRY_ENV=ci-local-preview.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as cls from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const answerSentryLocally = cls.answerSentryLocally as (ctx: unknown) => Promise<RegExp>;

/** The DSN host the shipped bundle reports to, read from the app, not retyped here. */
function appDsnIngestUrl(): string {
  const m = /https:\/\/[0-9a-f]+@([a-z0-9.-]+\.sentry\.io)\/(\d+)/.exec(read("src/lib/sentry.ts"));
  expect(m, "no Sentry DSN in src/lib/sentry.ts").toBeTruthy();
  return `https://${m![1]}/api/${m![2]}/envelope/?sentry_key=x&sentry_version=7`;
}

describe("Q296: the press sends no Sentry events", () => {
  it("answers the app's own Sentry ingest URL locally with a 200, and nothing else", async () => {
    const routes: { pattern: RegExp; handler: (r: unknown) => unknown }[] = [];
    await answerSentryLocally({ route: async (pattern: RegExp, handler: (r: unknown) => unknown) => { routes.push({ pattern, handler }); } });
    expect(routes).toHaveLength(1);
    const { pattern, handler } = routes[0];
    expect(pattern.test(appDsnIngestUrl())).toBe(true);
    for (const other of ["http://127.0.0.1:4173/dashboard", "https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/profiles", "https://api.stripe.com/v1/x", "https://evil.example/sentry.io/"]) {
      expect(pattern.test(other), other).toBe(false);
    }
    let fulfilled: { status?: number } | null = null;
    await handler({ fulfill: async (o: { status: number }) => { fulfilled = o; } });
    expect(fulfilled).toMatchObject({ status: 200 });
  });

  it("every press context installs it right after it is created", () => {
    const src = blankComments(read("scripts/audit/press-every-control.mjs"));
    const contexts = src.match(/browser\.newContext\(/g) ?? [];
    expect(contexts.length).toBeGreaterThan(0);
    const answered = src.match(/\}\);\s*await answerSentryLocally\(ctx\);/g) ?? [];
    expect(answered.length, "a browser context the press drives reaches the prod Sentry project").toBe(contexts.length);
  });

  it("the press build's Sentry environment is not production", () => {
    const press = parse(read(".github/workflows/press-every-control.yml")) as { jobs: { press: { steps: { uses?: string }[] } } };
    expect(press.jobs.press.steps.some((s) => s.uses === "./.github/actions/local-preview")).toBe(true);
    const action = parse(read(".github/actions/local-preview/action.yml")) as { runs: { steps: { name?: string; env?: Record<string, string>; run?: string }[] } };
    const build = action.runs.steps.find((s) => /npm run build/.test(s.run ?? ""));
    const env = build?.env?.VITE_SENTRY_ENV ?? "";
    expect(env).not.toBe("");
    expect(env).not.toMatch(/prod/i);
    // ...and the app really reads it first (else the tag does nothing).
    expect(blankComments(read("src/lib/sentry.ts"))).toMatch(/const ENV =\s*\(import\.meta\.env\.VITE_SENTRY_ENV as string \| undefined\) \|\|/);
  });
});
