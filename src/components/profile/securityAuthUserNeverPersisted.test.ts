/**
 * The Security tab's one auth read (["security", "auth-user"], Q1648) holds
 * the whole auth User: phone, app and user metadata, MFA factors and identity
 * data. It is never saved to the device (IndexedDB, 24 h) by the query
 * persister, and a cold start never shows a cached 2FA "On" before the real
 * read (lh-silent-failure review of f6001b527, note 2, fixed here).
 *
 * Both cards share the key, so each useQuery opts out: a query instance that
 * persists would carry the shared data to disk.
 *
 * @mutate src/components/profile/SignInMethodsCard.tsx |     meta: { persist: false }, |
 * @mutate src/components/profile/TwoFactorCard.tsx |     meta: { persist: false }, |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, type Query } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { persistOptions } from "@/lib/queryPersister";
import { SECURITY_AUTH_USER_KEY } from "./securityAuthUser";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const shouldPersist = (q: Query) => persistOptions.dehydrateOptions.shouldDehydrateQuery(q);

function queryWith(meta?: Record<string, unknown>): Query {
  const qc = new QueryClient();
  // The query's meta comes from its options, as useQuery({ meta }) builds it.
  const query = qc.getQueryCache().build(qc, { queryKey: [...SECURITY_AUTH_USER_KEY], meta });
  query.setData({ id: "u1", phone: "+15555550100" });
  return query as unknown as Query;
}

/** The body of the useQuery call that reads SECURITY_AUTH_USER_KEY in a file. */
function authUserQuery(src: string): string {
  const at = src.indexOf("queryKey: SECURITY_AUTH_USER_KEY,");
  expect(at, "the shared auth-user useQuery is in the file").toBeGreaterThan(0);
  return src.slice(at, src.indexOf("});", at));
}

describe("the Security tab's auth User is never saved to the device", () => {
  it("the persister refuses the auth-user query when it carries the meta", () => {
    expect(shouldPersist(queryWith({ persist: false }))).toBe(false);
  });

  it("without the meta it would persist (so the meta is what keeps it off disk)", () => {
    expect(shouldPersist(queryWith())).toBe(true);
  });

  for (const file of ["src/components/profile/SignInMethodsCard.tsx", "src/components/profile/TwoFactorCard.tsx"]) {
    it(`${file} opts its auth-user query out of persistence`, () => {
      expect(authUserQuery(read(file))).toMatch(/meta: \{ persist: false \}/);
    });
  }
});
